import { AuditLog } from "../security/audit-log.js";
import { BehavioralMonitor } from "../security/behavior-monitor.js";
import { DataTrustLayer } from "../security/data-trust.js";
import { FormalVerifier } from "../security/formal-verifier.js";
import { IntentSigner } from "../security/intent-signer.js";
import {
  validateIntentEnvelope
} from "../security/intent-schema.js";
import { PolicyEngine } from "../security/policy-engine.js";
import { ExecutionProxy } from "../execution/execution-proxy.js";
import { NonceStore } from "../execution/nonce-store.js";
import { DryRunBroker } from "../execution/dry-run-broker.js";
import { AlpacaPaperBroker } from "../execution/alpaca-paper-broker.js";

function blockedDecision(stage, reasons, details = {}) {
  return {
    allowed: false,
    blocked_by: stage,
    reasons,
    ...details
  };
}

export class ArmorClawPipeline {
  constructor({
    policy,
    config,
    clock = () => new Date()
  }) {
    this.policy = policy;
    this.config = config;
    this.clock = clock;
    this.dataTrust = new DataTrustLayer(policy);
    this.formalVerifier = new FormalVerifier({
      mode: config.formalVerifyMode,
      pythonPath: config.formalVerifyPython
    });
    this.policyEngine = new PolicyEngine(policy);
    this.behaviorMonitor = new BehavioralMonitor(policy, this.clock);
    this.signer = new IntentSigner({
      privateKeyPath: config.signer.privateKeyPath,
      publicKeyPath: config.signer.publicKeyPath,
      executionMode: config.executionMode
    });
    this.auditLog = new AuditLog({
      path: config.auditLogPath,
      hmacSecret: config.signer.auditHmacSecret
    });
    this.nonceStore = new NonceStore(config.nonceStorePath);
    this.executionProxy = new ExecutionProxy({
      policy,
      signer: this.signer,
      nonceStore: this.nonceStore,
      adapter:
        config.executionMode === "paper"
          ? new AlpacaPaperBroker(config.alpaca)
          : new DryRunBroker(),
      executionMode: config.executionMode
    });
  }

  async evaluateIntent(envelope) {
    const schemaDecision = validateIntentEnvelope(envelope);
    if (!schemaDecision.valid) {
      return blockedDecision("intent_schema", schemaDecision.errors);
    }

    const trustedDecision = this.dataTrust.evaluate(schemaDecision.envelope);
    if (!trustedDecision.allowed) {
      return blockedDecision("data_trust", trustedDecision.reasons, {
        envelope: trustedDecision.sanitized_envelope
      });
    }

    const trustedEnvelope = trustedDecision.sanitized_envelope;

    const formalDecision = await this.formalVerifier.verify(
      trustedEnvelope,
      this.policy
    );
    if (!formalDecision.allowed) {
      return blockedDecision(
        "formal_verifier",
        formalDecision.reasons ?? ["formal verification failed"],
        {
          unsat_core: formalDecision.unsat_core ?? []
        }
      );
    }

    const policyDecision = this.policyEngine.evaluate(trustedEnvelope);
    if (!policyDecision.allowed) {
      return blockedDecision(
        "policy_engine",
        policyDecision.violations.map((violation) => violation.message),
        {
          violations: policyDecision.violations
        }
      );
    }

    const behaviorDecision = this.behaviorMonitor.evaluate(trustedEnvelope);
    if (!behaviorDecision.allowed) {
      return blockedDecision("behavior_monitor", behaviorDecision.reasons, {
        behavior_snapshot: behaviorDecision.snapshot
      });
    }

    const signedIntent = this.signer.sign({
      approved_at: this.clock().toISOString(),
      policy_profile: this.policy.profile,
      envelope: trustedEnvelope,
      stage_checks: {
        trusted_sources_count: trustedDecision.trusted_sources_count,
        formal_summary: formalDecision.summary ?? null,
        behavior_snapshot: behaviorDecision.snapshot
      }
    });

    return {
      allowed: true,
      envelope: trustedEnvelope,
      signed_intent: signedIntent
    };
  }

  async auditDecision(decision, envelope) {
    return this.auditLog.append({
      actor_id: envelope?.actor_id ?? decision?.envelope?.actor_id ?? "unknown",
      intent_id: envelope?.id ?? decision?.envelope?.id ?? null,
      allowed: decision.allowed,
      blocked_by: decision.blocked_by ?? null,
      reasons: decision.reasons ?? [],
      execution: decision.execution ?? null
    });
  }

  async processIntent(envelope) {
    const evaluation = await this.evaluateIntent(envelope);
    if (!evaluation.allowed) {
      const auditRecord = await this.auditDecision(evaluation, envelope);
      return {
        ...evaluation,
        audit_record: auditRecord
      };
    }

    const executionDecision = await this.executionProxy.execute(
      evaluation.signed_intent
    );
    if (!executionDecision.allowed) {
      const blockedExecution = {
        ...evaluation,
        ...executionDecision,
        allowed: false
      };
      const auditRecord = await this.auditDecision(blockedExecution, evaluation.envelope);
      return {
        ...blockedExecution,
        audit_record: auditRecord
      };
    }

    this.behaviorMonitor.record(evaluation.envelope);
    const finalDecision = {
      ...evaluation,
      execution: executionDecision.execution
    };
    const auditRecord = await this.auditDecision(finalDecision, evaluation.envelope);
    return {
      ...finalDecision,
      audit_record: auditRecord
    };
  }
}
