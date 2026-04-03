import { resolve } from "node:path";

export function createRuntimeConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };

  return {
    executionMode: env.EXECUTION_MODE ?? "dry-run",
    formalVerifyMode: env.FORMAL_VERIFY_MODE ?? "strict",
    formalVerifyPython: env.FORMAL_VERIFY_PYTHON ?? "python",
    policyPath: resolve(
      process.cwd(),
      env.POLICY_PATH ?? "./policies/financial-guardrails.json"
    ),
    auditLogPath: resolve(
      process.cwd(),
      env.AUDIT_LOG_PATH ?? "./runtime/audit/armorclaw.audit.jsonl"
    ),
    nonceStorePath: resolve(
      process.cwd(),
      env.NONCE_STORE_PATH ?? "./runtime/state/nonces.json"
    ),
    signer: {
      privateKeyPath: env.ARMORCLAW_ED25519_PRIVATE_KEY_PATH
        ? resolve(process.cwd(), env.ARMORCLAW_ED25519_PRIVATE_KEY_PATH)
        : null,
      publicKeyPath: env.ARMORCLAW_ED25519_PUBLIC_KEY_PATH
        ? resolve(process.cwd(), env.ARMORCLAW_ED25519_PUBLIC_KEY_PATH)
        : null,
      auditHmacSecret:
        env.ARMORCLAW_AUDIT_HMAC_SECRET ?? "development-audit-secret"
    },
    alpaca: {
      baseUrl: env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets",
      apiKey: env.ALPACA_API_KEY ?? "",
      apiSecret: env.ALPACA_API_SECRET ?? ""
    },
    port: Number(env.PORT ?? 1933)
  };
}
