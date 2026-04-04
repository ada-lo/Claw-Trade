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

function traceEntry(layer, name, status, detail = null, extra = {}) {
  return {
    layer,
    name,
    status,
    detail,
    ...extra
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
      url: config.z3VerifierUrl,
      fetchImpl: config.verifierFetch
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

  async evaluateIntent(envelope, { onLayer } = {}) {
    const layerTrace = [];
    const emit = (entry) => {
      layerTrace.push(entry);
      if (typeof onLayer === "function") onLayer(entry);
    };

    const trustedDecision = this.dataTrust.evaluate(envelope);
    if (!trustedDecision.allowed) {
      emit(
        traceEntry("L1", "DataTrust", "BLOCKED", trustedDecision.reasons.join(" "))
      );
      return blockedDecision("data_trust", trustedDecision.reasons, {
        envelope: trustedDecision.sanitized_envelope,
        layer_trace: layerTrace
      });
    }

    emit(
      traceEntry(
        "L1",
        "DataTrust",
        "PASS",
        `${trustedDecision.trusted_sources_count} trusted source(s)`
      )
    );
    emit(traceEntry("L2", "Sandbox", "PASS", "external"));

    const schemaDecision = validateIntentEnvelope(trustedDecision.sanitized_envelope);
    if (!schemaDecision.valid) {
      emit(
        traceEntry("L3", "Schema", "BLOCKED", schemaDecision.errors.join(" "))
      );
      return blockedDecision("intent_schema", schemaDecision.errors, {
        envelope: schemaDecision.envelope,
        layer_trace: layerTrace
      });
    }

    emit(traceEntry("L3", "Schema", "PASS"));
    const trustedEnvelope = schemaDecision.envelope;

    const formalDecision = await this.formalVerifier.verify(
      trustedEnvelope,
      this.policy
    );
    if (!formalDecision.allowed) {
      emit(
        traceEntry(
          "L4",
          "Z3 Verifier",
          "BLOCKED",
          (formalDecision.reasons ?? ["formal verification failed"]).join(" ")
        )
      );
      return blockedDecision(
        "formal_verifier",
        formalDecision.reasons ?? ["formal verification failed"],
        {
          unsat_core: formalDecision.unsat_core ?? [],
          layer_trace: layerTrace
        }
      );
    }

    emit(
      traceEntry(
        "L4",
        "Z3 Verifier",
        "PASS",
        formalDecision.reason ?? "SAT: intent satisfies all policy constraints"
      )
    );

    const policyDecision = this.policyEngine.evaluate(trustedEnvelope);
    if (!policyDecision.allowed) {
      emit(
        traceEntry(
          "L5",
          "ArmorClaw",
          "BLOCKED",
          policyDecision.violations.map((violation) => violation.message).join(" ")
        )
      );
      return blockedDecision(
        "policy_engine",
        policyDecision.violations.map((violation) => violation.message),
        {
          violations: policyDecision.violations,
          layer_trace: layerTrace
        }
      );
    }

    emit(traceEntry("L5", "ArmorClaw", "PASS"));

    const behaviorDecision = this.behaviorMonitor.evaluate(trustedEnvelope);
    if (!behaviorDecision.allowed) {
      emit(
        traceEntry(
          "L6",
          "BehaviorMonitor",
          "BLOCKED",
          behaviorDecision.reasons.join(" ")
        )
      );
      return blockedDecision("behavior_monitor", behaviorDecision.reasons, {
        behavior_snapshot: behaviorDecision.snapshot,
        layer_trace: layerTrace
      });
    }

    emit(
      traceEntry(
        "L6",
        "BehaviorMonitor",
        "PASS",
        `recent_calls=${behaviorDecision.snapshot.recent_call_count}`
      )
    );

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

    emit(traceEntry("L7", "IntentSigner", "SIGNED"));
    return {
      allowed: true,
      envelope: trustedEnvelope,
      signed_intent: signedIntent,
      layer_trace: layerTrace
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

  async processIntent(envelope, { onLayer } = {}) {
    const emit = (entry) => {
      if (typeof onLayer === "function") onLayer(entry);
    };

    const evaluation = await this.evaluateIntent(envelope, { onLayer });
    if (!evaluation.allowed) {
      const auditRecord = await this.auditDecision(evaluation, envelope);
      const auditEntry = traceEntry("L9", "AuditLog", "RECORDED", `hash=${auditRecord.entry_hash}`);
      emit(auditEntry);
      const layerTrace = [
        ...(evaluation.layer_trace ?? []),
        auditEntry
      ];
      return {
        ...evaluation,
        audit_record: auditRecord,
        layer_trace: layerTrace
      };
    }

    const executionDecision = await this.executionProxy.execute(
      evaluation.signed_intent
    );
    if (!executionDecision.allowed) {
      const execEntry = traceEntry(
        "L8",
        "ExecutionProxy",
        "BLOCKED",
        executionDecision.reasons.join(" ")
      );
      emit(execEntry);
      const executionTrace = [
        ...(evaluation.layer_trace ?? []),
        execEntry
      ];
      const blockedExecution = {
        ...evaluation,
        ...executionDecision,
        allowed: false,
        layer_trace: executionTrace
      };
      const auditRecord = await this.auditDecision(blockedExecution, evaluation.envelope);
      const auditEntry = traceEntry("L9", "AuditLog", "RECORDED", `hash=${auditRecord.entry_hash}`);
      emit(auditEntry);
      const finalTrace = [
        ...executionTrace,
        auditEntry
      ];
      return {
        ...blockedExecution,
        audit_record: auditRecord,
        layer_trace: finalTrace
      };
    }

    this.behaviorMonitor.record(evaluation.envelope);
    const executionStatus = executionDecision.execution?.simulated
      ? "DRY-RUN"
      : "PASS";
    const executionDetail = executionDecision.execution?.simulated
      ? "no real order sent"
      : `broker=${executionDecision.execution?.broker ?? "unknown"}`;
    const execEntry = traceEntry("L8", "ExecutionProxy", executionStatus, executionDetail);
    emit(execEntry);
    const executionTrace = [
      ...(evaluation.layer_trace ?? []),
      execEntry
    ];
    const finalDecision = {
      ...evaluation,
      execution: executionDecision.execution,
      layer_trace: executionTrace
    };
    const auditRecord = await this.auditDecision(finalDecision, evaluation.envelope);
    const auditEntry = traceEntry("L9", "AuditLog", "RECORDED", `hash=${auditRecord.entry_hash}`);
    emit(auditEntry);
    const finalTrace = [
      ...executionTrace,
      auditEntry
    ];
    return {
      ...finalDecision,
      audit_record: auditRecord,
      layer_trace: finalTrace
    };
  }
}
