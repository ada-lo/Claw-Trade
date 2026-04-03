# Claw-Trade

Secure-by-default OpenClaw and ArmorClaw runtime for a financial agent. This repo implements the non-LLM-sandbox layers from the architecture you attached, so the reasoning sandbox can plug into a deterministic perimeter instead of touching trading APIs directly.

## Layer Map

- Layer 1: `DataTrustLayer` sanitizes inputs, redacts secrets, and requires trusted evidence before a trade can proceed.
- Layer 2: intentionally external.
- Layer 3: `validateIntentEnvelope` enforces a strict structured intent contract.
- Layer 4: `FormalVerifier` runs a Python Z3 verifier when available and can fall back to a deterministic JS verifier for local dry runs.
- Layer 5: `PolicyEngine` enforces deny-by-default ArmorClaw runtime rules from `policies/financial-guardrails.json`.
- Layer 6: `BehavioralMonitor` blocks runaway loops, unusual ticker drift, and cooldown violations.
- Layer 7: `IntentSigner` cryptographically signs approved intents with Ed25519.
- Layer 8: `ExecutionProxy` verifies signatures, enforces nonce uniqueness, and owns the Alpaca paper-trading credentials.
- Layer 9: `AuditLog` writes hash-chained JSONL audit records with HMAC integrity tags.

## Quick Start

```bash
npm run generate:keys
npm test
node src/demo.js allowed
node src/demo.js blocked
node src/server.js
```

Environment is driven by `.env.example`. The safest defaults are:

- `EXECUTION_MODE=dry-run`
- `FORMAL_VERIFY_MODE=strict` for real paper-trade flows once `z3-solver` is installed for Python
- file-backed Ed25519 keys generated with `npm run generate:keys`
- Alpaca pointed only at `https://paper-api.alpaca.markets`

## OpenClaw Integration

Use the plugin adapter in [src/openclaw/plugin.js](/d:/PROJECTSSS/Claw-Trade/src/openclaw/plugin.js). The intended flow is:

1. Sandbox or planner emits a structured tool call.
2. `beforeToolCall` converts it into an intent envelope and validates it through layers 1, 3, 4, 5, and 6.
3. Approved trade intents receive a signed security context.
4. Only the execution proxy or `/process` endpoint is allowed to touch Alpaca credentials.

Sensitive trade calls should go through `executeApprovedIntent` or the HTTP `/process` route. Read-only tools can still use the `beforeToolCall` gate without going through the trade proxy.

## Repo Layout

- [src/create-pipeline.js](/d:/PROJECTSSS/Claw-Trade/src/create-pipeline.js)
- [src/pipeline/armorclaw-pipeline.js](/d:/PROJECTSSS/Claw-Trade/src/pipeline/armorclaw-pipeline.js)
- [src/openclaw/plugin.js](/d:/PROJECTSSS/Claw-Trade/src/openclaw/plugin.js)
- [python/formal_verify.py](/d:/PROJECTSSS/Claw-Trade/python/formal_verify.py)
- [policies/financial-guardrails.json](/d:/PROJECTSSS/Claw-Trade/policies/financial-guardrails.json)
- [docs/architecture.md](/d:/PROJECTSSS/Claw-Trade/docs/architecture.md)
- [docs/intent-model.md](/d:/PROJECTSSS/Claw-Trade/docs/intent-model.md)
- [SECURITY.md](/d:/PROJECTSSS/Claw-Trade/SECURITY.md)
- [AGENTS.md](/d:/PROJECTSSS/Claw-Trade/AGENTS.md)

## Notes

Paper trading is fail-closed. If the formal verifier, signature check, nonce check, or policy evaluation fails, no order is sent. The default demo mode stays on `dry-run` so you can wire OpenClaw into this safely before any paper account is connected.
