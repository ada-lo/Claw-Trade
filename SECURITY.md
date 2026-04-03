# SECURITY

## Security Posture

This repo treats the LLM side of the system as untrusted. The only thing it is allowed to produce is a structured intent envelope. Nothing in the reasoning layer should ever hold brokerage credentials or call Alpaca directly.

## Mandatory Controls

- Keep `EXECUTION_MODE=dry-run` until file-backed signing keys and Alpaca paper credentials are configured.
- Keep `FORMAL_VERIFY_MODE=strict` for paper mode. Local `fallback` or `js` modes are for development only.
- Route all sensitive trade execution through [src/execution/execution-proxy.js](/d:/PROJECTSSS/Claw-Trade/src/execution/execution-proxy.js).
- Never share `ALPACA_API_SECRET` with OpenClaw prompts, skills, memory files, or the sandbox container.
- Reject any intent that is missing a nonce, signature, or policy-compliant envelope.
- Treat suspicious input text, prompt-injection markers, and untrusted sources as hard blocks for trade intents.
- Keep OpenClaw web tools and browser control disabled for small-model agents unless you intentionally move that capability behind a stronger sandbox boundary.
- Keep Docker-published gateway and Control UI ports loopback-only unless you have an explicit reverse proxy and `gateway.trustedProxies` configured.
- Do not keep live provider or brokerage keys in tracked files. If any real credentials were placed in a local `.env`, rotate them before sharing the repo.

## What This Repo Covers

- OpenClaw-configured L2 sandbox settings and agent isolation policy
- Input trust and sanitization
- Structured intent validation
- Deterministic formal verification
- Policy-as-code enforcement
- Behavioral anomaly blocking
- Cryptographic signing and replay protection
- Paper-trading execution proxy
- Tamper-evident audit logging

## What This Repo Does Not Cover

- A custom sandbox implementation beyond what OpenClaw provides through configuration
- GPU, browser, or VM hardening around OpenClaw itself
- Network segmentation around the host running OpenClaw

Those belong to the external sandbox boundary and host deployment.

## Paper Mode Checklist

1. Generate Ed25519 keys with `npm run generate:keys`.
2. Install Python `z3-solver` for strict formal verification.
3. Set Alpaca credentials in environment variables only.
4. Keep Alpaca on the paper endpoint.
5. Confirm OpenClaw trade skills call the proxy instead of the broker directly.
6. Review [policies/financial-guardrails.json](/d:/PROJECTSSS/Claw-Trade/policies/financial-guardrails.json) and tighten ticker/risk limits before demos.
