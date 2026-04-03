# Claw-Trade

Claw-Trade is a financial AI agent runtime built around OpenClaw, ArmorClaw, and Z3-style formal verification. The repo separates reasoning from execution so an LLM can propose an intent, but only a deterministic security pipeline is allowed to approve, sign, and execute a trade.

This repo uses OpenClaw for the reasoning/runtime layer and keeps the enforcement stack in this codebase:

- OpenClaw plugin registration for `alpaca.place_order`
- deterministic validation, policy, and formal verification
- signing, replay protection, and audit logging
- dry-run or Alpaca paper execution only

## What It Does

- Accepts structured trade intents from an OpenClaw agent, Telegram, or the local demo scripts.
- Verifies those intents against policy and formal constraints before execution.
- Signs approved intents cryptographically.
- Sends only approved intents through a dry-run or Alpaca paper-trading execution proxy.
- Records every decision in a tamper-evident audit log.

## 9-Layer Security Flow

1. `L1 DataTrust`
Sanitizes raw inputs, redacts secrets, and blocks suspicious prompt-injection text.

2. `L2 Sandbox`
Provided by OpenClaw runtime configuration in `openclaw.json5`. The Claw-Trade pipeline still treats all model output as untrusted and re-validates it before execution.

3. `L3 Schema`
Validates the structured intent envelope before any enforcement logic runs.

4. `L4 Z3 Verifier`
Calls the Z3 microservice over HTTP and blocks intents that violate deterministic constraints.

5. `L5 ArmorClaw Policy Engine`
Enforces runtime rules from `policies/financial-guardrails.json`.

6. `L6 BehaviorMonitor`
Detects suspicious loops, unusual ticker drift, and abnormal activity patterns.

7. `L7 IntentSigner`
Signs approved intents with Ed25519.

8. `L8 ExecutionProxy`
Verifies signatures and nonces, then executes in dry-run or paper mode.

9. `L9 AuditLog`
Writes a hash-chained audit record for every allow/block decision.

## Main Components

- `src/pipeline/armorclaw-pipeline.js`
Main orchestration for the 9-layer flow.

- `src/openclaw/plugin.js`
OpenClaw-facing adapter that exposes the guarded `alpaca.place_order` tool and maps tool params into ArmorClaw intent envelopes.

- `openclaw-plugin/armorclaw-financial-guard/index.mjs`
Native OpenClaw plugin entry that registers the guarded trading tool with the gateway runtime.

- `src/security/formal-verifier.js`
HTTP client for the Z3 verifier microservice.

- `python/formal_verify.py`
FastAPI service that exposes `/health` and `/verify`.

- `src/demo.js`
Local demo entrypoint that prints a layer-by-layer pipeline trace.

## Prerequisites

- Docker Desktop
- Node.js 22+
- npm 11+

## Environment Setup
clone the repo then proceed.
1. Copy `.env.example` to `.env`.
2. Fill in only the provider keys you actually use.
3. Keep `EXECUTION_MODE=dry-run` until file-backed signing keys and Alpaca paper credentials are configured.
4. Use only paper-trading Alpaca keys, never live keys.
5. Set:

```bash
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

Important:
- `.env` is ignored by git.
- If you have ever pasted real keys into a tracked file, terminal screenshot, or chat log, rotate them.

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
- the ArmorClaw API is available on `http://localhost:1933/health`
- the OpenClaw gateway is available on `ws://localhost:18789`
- the Control UI is available on `http://localhost:18789/openclaw/`

The `openclaw` service starts both the local ArmorClaw API and the OpenClaw gateway through:

```bash
/app/scripts/openclaw-runtime.sh
```

## Check That Everything Works

### 1. Verify service health

```bash
docker compose ps
curl http://localhost:1933/health
docker exec openclaw_runtime openclaw gateway health
```

You want:
- `execution_mode` to match your `.env`
- `Gateway Health OK`
- no `spawn python ENOENT`
- no `exit 137`

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

### 3. Verify the full pipeline with demo commands

```bash
docker exec openclaw_runtime npm run demo:allowed
docker exec openclaw_runtime npm run demo:blocked
```

Expected:
- `allowed` passes through all layers
- `blocked` is rejected at `L4 Z3 Verifier`

Paper-mode success criteria:
- the newest audit entry shows `execution.broker: "alpaca-paper"`
- the newest audit entry does not show `simulated: true`

### 4. Run automated tests

```bash
npm test
```

## Use the OpenClaw UI

Open:

```text
http://localhost:18789/openclaw/
```

If you need a fresh dashboard URL with the current token:

```bash
docker exec openclaw_runtime openclaw dashboard
```

## Pairing and Browser Login

If the UI shows `pairing required`, OpenClaw sees your browser as a new device and wants a one-time approval.

List devices:

```bash
docker exec openclaw_runtime openclaw devices list
```

Approve the newest pending device:

```bash
docker exec openclaw_runtime openclaw devices approve --latest
```

Notes:
- Docker often makes the host browser appear as a LAN client, so pairing is expected.
- `allowInsecureAuth` helps with local HTTP usage, but it does not automatically skip pairing.
- If you see `gateway token mismatch`, close stale tabs and reopen the fresh dashboard URL from the current container session.

## Submit a Trade From Chat

The guarded `alpaca.place_order` tool is available through OpenClaw chat and Telegram. Start with the Control UI because it is easier to inspect failures there.

Example prompt:

```text
Buy 10 shares of AAPL at 170 using paper funds only.
```

The OpenClaw plugin accepts normal model-emitted tool arguments and normalizes stringly-typed values such as:

- `"10"` for quantity
- `"170"` for limit price
- `"true"` for market-hours state
- comma-separated focused tickers
- JSON-string evidence arrays

That normalization happens before ArmorClaw evaluates the intent.

After a chat-triggered trade attempt, inspect the newest audit record:

```bash
docker exec openclaw_runtime tail -n 1 /app/runtime/audit/armorclaw.audit.jsonl
```

Successful paper execution looks like:
- `allowed: true`
- `execution.broker: "alpaca-paper"`
- an Alpaca paper `order_id`

If Alpaca rejects the order with `401 unauthorized`, the OpenClaw and ArmorClaw wiring is still correct. Only the Alpaca paper credentials need to be fixed.

## How OpenClaw Uses Models

Configured in `openclaw.json5`:

- `planner`, `data`, `strategy`, `risk`
Primary: `groq/meta-llama/llama-4-scout-17b-16e-instruct`
Fallbacks: `google/gemini-2.0-flash` -> `huggingface/Qwen/Qwen3-8B:fastest`

- `technical-analysis`, `fundamental-analysis`, `sentiment-analysis`
Primary: `google/gemini-2.0-flash`
Fallbacks: `groq/meta-llama/llama-4-scout-17b-16e-instruct` -> `huggingface/Qwen/Qwen3-8B:fastest`

Sandbox note:
- `agents.defaults.sandbox.mode` is currently `off` inside the containerized OpenClaw runtime because nested Docker is not available inside the container PATH.
- The Claw-Trade pipeline still treats all model output as untrusted and re-validates it through the 9-layer enforcement path.

## How the Runtime Works Internally

1. OpenClaw or a demo produces a structured trade intent.
2. The pipeline validates the envelope and sanitizes input.
3. The Node runtime sends the trade details to the Z3 verifier microservice at `Z3_VERIFIER_URL`.
4. If Z3 returns `allowed: false`, the intent is blocked at `L4`.
5. If policy and behavior checks pass, the intent is signed at `L7`.
6. The execution proxy verifies the signature and nonce, then executes in dry-run or paper mode.
7. The audit log records the final decision with a hash chain.

## Repo Layout

- `src/create-pipeline.js`
- `src/pipeline/armorclaw-pipeline.js`
- `src/openclaw/plugin.js`
- `src/security/formal-verifier.js`
- `python/formal_verify.py`
- `policies/financial-guardrails.json`
- `docs/architecture.md`
- `docs/intent-model.md`
- `SECURITY.md`
- `AGENTS.md`

## Troubleshooting

### Gateway still shows old config

The named `openclaw_config` volume may be stale. Reset it:

```bash
docker compose down -v
docker compose up --build -d
```

### OpenClaw chat returns tool-call validation errors

- Restart after plugin changes: `docker compose restart openclaw`
- The current plugin accepts stringly-typed values and normalizes them before policy evaluation.
- If you still see schema errors, inspect `src/openclaw/plugin.js` and rerun `npm test`.

### Paper trade fails with `401 unauthorized`

- Confirm `ALPACA_BASE_URL=https://paper-api.alpaca.markets`
- Confirm the key and secret are from Alpaca paper trading, not live trading
- Restart the stack after changing `.env`: `docker compose up -d`
- Recheck the newest audit line for `execution.broker: "alpaca-paper"`

### Browser cannot reach the UI

- Check `docker compose ps`
- Check `docker logs openclaw_runtime --tail 100`
- Confirm the UI is opened on `http://localhost:18789/openclaw/`

### Z3 verifier is unhealthy

```bash
docker compose logs --tail=100 z3_verifier
curl http://localhost:5001/health
```

## Security Notes

- Keep `EXECUTION_MODE=dry-run` until you are confident in the flow.
- Use only paper-trading credentials.
- Do not put live brokerage or provider secrets in prompts, screenshots, or tracked files.
- Review `SECURITY.md` before any wider sharing or demo.
