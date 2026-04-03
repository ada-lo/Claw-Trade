# Claw-Trade

Claw-Trade is a financial AI agent runtime built around OpenClaw, ArmorClaw, and Z3-style formal verification. The repo separates reasoning from execution so an LLM can propose an intent, but only a deterministic security pipeline is allowed to approve, sign, and execute a trade.

This repo implements the non-sandbox layers of the architecture. The LLM sandbox itself is treated as external and untrusted.

## What It Does

- Accepts structured trade intents from an OpenClaw agent or local demo.
- Verifies those intents against policy and formal constraints before execution.
- Signs approved intents cryptographically.
- Sends only approved intents through a dry-run or paper-trading execution proxy.
- Records every decision in a tamper-evident audit log.

## 9-Layer Security Flow

1. `L1 DataTrust`
Sanitizes raw inputs, redacts secrets, and blocks suspicious prompt-injection text.

2. `L2 Sandbox`
External boundary. The LLM sandbox is not implemented in this repo, but the pipeline treats it as untrusted input.

3. `L3 Schema`
Validates the structured intent envelope before any enforcement logic runs.

4. `L4 Z3 Verifier`
Calls the Z3 microservice over HTTP and blocks intents that violate deterministic constraints.

5. `L5 ArmorClaw Policy Engine`
Enforces runtime rules from [policies/financial-guardrails.json](/d:/PROJECTSSS/Claw-Trade/policies/financial-guardrails.json).

6. `L6 BehaviorMonitor`
Detects suspicious loops, unusual ticker drift, and abnormal activity patterns.

7. `L7 IntentSigner`
Signs approved intents with Ed25519.

8. `L8 ExecutionProxy`
Verifies signatures and nonces, then executes in dry-run or paper mode.

9. `L9 AuditLog`
Writes a hash-chained audit record for every allow/block decision.

## Main Components

- [src/pipeline/armorclaw-pipeline.js](/d:/PROJECTSSS/Claw-Trade/src/pipeline/armorclaw-pipeline.js)
Main orchestration for the 9-layer flow.

- [src/security/formal-verifier.js](/d:/PROJECTSSS/Claw-Trade/src/security/formal-verifier.js)
HTTP client for the Z3 verifier microservice.

- [python/formal_verify.py](/d:/PROJECTSSS/Claw-Trade/python/formal_verify.py)
FastAPI service that exposes `/health` and `/verify`.

- [src/openclaw/plugin.js](/d:/PROJECTSSS/Claw-Trade/src/openclaw/plugin.js)
OpenClaw-facing adapter for tool-call interception.

- [src/demo.js](/d:/PROJECTSSS/Claw-Trade/src/demo.js)
Local demo entrypoint that prints a layer-by-layer pipeline trace.

## Prerequisites

- Docker Desktop
- Node.js 22+
- npm 11+

## Environment Setup

1. Copy `.env.example` to `.env`.
2. Fill in provider keys only for the services you actually use.
3. Keep `EXECUTION_MODE=dry-run` while testing.
4. Use only paper-trading Alpaca keys, never live keys.

Important:
- `.env` is ignored by git.
- If you have already put real keys in a tracked file or shared screenshot, rotate them.

## Run With Docker

From the repo root:

```bash
docker compose down -v
docker compose up --build -d
docker compose ps
```

Expected result:
- `openclaw_runtime` is running
- `z3_verifier` is running
- the OpenClaw gateway is not auto-started

The `openclaw` container only runs:

```bash
node src/server.js
```

The gateway starts only when you explicitly run it.

## Check That Everything Works

### 1. Verify container health

```bash
docker compose logs --tail=100 openclaw
docker compose logs --tail=100 z3_verifier
```

You want:
- no `spawn python ENOENT`
- no `exit 137`
- no gateway auto-start in the `openclaw` container

### 2. Verify the Z3 service

```bash
curl http://localhost:5001/health
```

Expected:

```json
{"status":"ok"}
```

Allowed case:

```bash
curl -X POST http://localhost:5001/verify ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"buy\",\"ticker\":\"AAPL\",\"quantity\":10,\"limit_price\":170.0,\"daily_spent\":0,\"daily_limit\":10000,\"allowed_tickers\":[\"AAPL\",\"MSFT\",\"TSLA\",\"NVDA\",\"GOOGL\"]}"
```

Blocked case:

```bash
curl -X POST http://localhost:5001/verify ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"buy\",\"ticker\":\"AAPL\",\"quantity\":100,\"limit_price\":170.0,\"daily_spent\":9000,\"daily_limit\":10000,\"allowed_tickers\":[\"AAPL\",\"MSFT\",\"TSLA\",\"NVDA\",\"GOOGL\"]}"
```

Expected blocked reason:
- `UNSAT: trade would exceed daily limit`

### 3. Verify the full demo pipeline

```bash
docker exec -it openclaw_runtime node src/demo.js allowed
docker exec -it openclaw_runtime node src/demo.js blocked
```

Expected:
- `allowed` passes through all layers
- `blocked` is rejected at `L4 Z3 Verifier`

Example output shape:

```text
L1 DataTrust: ✅ PASS
L2 Sandbox: ✅ PASS — external
L3 Schema: ✅ PASS
L4 Z3 Verifier: ❌ BLOCKED — UNSAT: trade would exceed daily limit
L9 AuditLog: ✅ RECORDED — hash=...
```

### 4. Run automated tests

```bash
npm test
```

## Start the OpenClaw Gateway Manually

The gateway is intentionally manual. Start it only when you want the UI:

```bash
docker exec -it openclaw_runtime openclaw gateway run
```

If OpenClaw says `gateway.mode` is unset, initialize it once:

```bash
docker exec -it openclaw_runtime openclaw config set gateway.mode local
docker exec -it openclaw_runtime openclaw config set gateway.bind lan
docker exec -it openclaw_runtime openclaw config set gateway.controlUi.allowInsecureAuth true
```

Then run:

```bash
docker exec -it openclaw_runtime openclaw gateway run
```

Open the UI at:

```text
http://localhost:18789
```

## Pairing and First Browser Login

If the UI shows `pairing required`, that means OpenClaw sees your browser as a new device and wants a one-time approval.

List devices:

```bash
docker exec -it openclaw_runtime openclaw devices list
```

Approve the newest pending device:

```bash
docker exec -it openclaw_runtime openclaw devices approve --latest
```

Then refresh the browser and connect again.

Notes:
- Docker often makes the host browser appear as a LAN client, so pairing is expected.
- `allowInsecureAuth` helps with local HTTP usage, but it does not automatically skip pairing.

## How OpenClaw Uses Models

Configured in [openclaw.json5](/d:/PROJECTSSS/Claw-Trade/openclaw.json5):

- `planner`, `data`, `strategy`, `risk`
Primary: `groq/llama-4-scout-17b-16e-instruct`
Fallbacks: `google/gemini-2.0-flash` -> `huggingface/meta-llama/Llama-4-Scout-17B-16E-Instruct:fastest`

- `technical-analysis`, `fundamental-analysis`, `sentiment-analysis`
Primary: `google/gemini-2.0-flash`
Fallbacks: `groq/llama-4-scout-17b-16e-instruct` -> `huggingface/meta-llama/Llama-4-Scout-17B-16E-Instruct:fastest`

## How the Runtime Works Internally

The normal path is:

1. OpenClaw or a demo produces a structured trade intent.
2. The pipeline validates the envelope and sanitizes input.
3. The Node runtime sends the trade details to the Z3 verifier microservice at `Z3_VERIFIER_URL`.
4. If Z3 returns `allowed: false`, the intent is blocked at `L4`.
5. If policy and behavior checks pass, the intent is signed at `L7`.
6. The execution proxy verifies the signature and nonce, then executes in dry-run or paper mode.
7. The audit log records the final decision with a hash chain.

## Repo Layout

- [src/create-pipeline.js](/d:/PROJECTSSS/Claw-Trade/src/create-pipeline.js)
- [src/pipeline/armorclaw-pipeline.js](/d:/PROJECTSSS/Claw-Trade/src/pipeline/armorclaw-pipeline.js)
- [src/openclaw/plugin.js](/d:/PROJECTSSS/Claw-Trade/src/openclaw/plugin.js)
- [src/security/formal-verifier.js](/d:/PROJECTSSS/Claw-Trade/src/security/formal-verifier.js)
- [python/formal_verify.py](/d:/PROJECTSSS/Claw-Trade/python/formal_verify.py)
- [policies/financial-guardrails.json](/d:/PROJECTSSS/Claw-Trade/policies/financial-guardrails.json)
- [docs/architecture.md](/d:/PROJECTSSS/Claw-Trade/docs/architecture.md)
- [docs/intent-model.md](/d:/PROJECTSSS/Claw-Trade/docs/intent-model.md)
- [SECURITY.md](/d:/PROJECTSSS/Claw-Trade/SECURITY.md)
- [AGENTS.md](/d:/PROJECTSSS/Claw-Trade/AGENTS.md)

## Troubleshooting

### Gateway still shows old config

The named `openclaw_config` volume may be stale. Reset it:

```bash
docker compose down -v
docker compose up --build -d
```

### `spawn python ENOENT`

That should no longer happen in the current build. The verifier now uses HTTP, not local Python spawn. If you still see it, rebuild the containers and confirm the new image is running.

### Browser cannot reach the UI

- Make sure the gateway is actually running.
- Check `docker compose ps`.
- Check `docker logs openclaw_runtime --tail 100`.
- Confirm the UI is opened on `http://localhost:18789`, not the internal browser-control port.

### Z3 verifier is unhealthy

```bash
docker compose logs --tail=100 z3_verifier
curl http://localhost:5001/health
```

## Security Notes

- Keep `EXECUTION_MODE=dry-run` until you are confident in the flow.
- Use only paper-trading credentials.
- Do not put live brokerage secrets in prompts, screenshots, or tracked files.
- Review [SECURITY.md](/d:/PROJECTSSS/Claw-Trade/SECURITY.md) before any wider sharing or demo.
