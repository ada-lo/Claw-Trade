import { spawn } from "node:child_process";
import { resolve } from "node:path";

function verifyWithJs(envelope, policy, context = {}) {
  const intent = envelope.intent;
  const state = envelope.state ?? {};
  const riskLimits = policy.risk_limits ?? {};
  const market = policy.market ?? {};
  const reasons = [];
  const orderNotional = intent.notional_usd ?? intent.quantity * intent.limit_price;
  const dailyAfter = (state.current_daily_notional_usd ?? 0) + orderNotional;
  const exposureAfter = (state.current_portfolio_exposure_usd ?? 0) + orderNotional;

  if (orderNotional > (riskLimits.max_single_order_notional_usd ?? 0)) {
    reasons.push("single_order_limit");
  }

  if (dailyAfter > (riskLimits.max_daily_notional_usd ?? 0)) {
    reasons.push("daily_limit");
  }

  if (exposureAfter > (riskLimits.max_portfolio_exposure_usd ?? 0)) {
    reasons.push("portfolio_exposure_limit");
  }

  if (intent.quantity > (riskLimits.max_shares_per_order ?? 0)) {
    reasons.push("share_limit");
  }

  if (!asSet(market.allowed_tickers).has(intent.ticker)) {
    reasons.push("ticker_allowlist");
  }

  if (!asSet(market.allowed_asset_classes).has(intent.asset_class)) {
    reasons.push("asset_class_allowlist");
  }

  if (market.market_hours_only && state.market_hours_open !== true) {
    reasons.push("market_session_gate");
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      code: "js_unsat",
      reasons: [
        "formal verification rejected the proposed action"
      ],
      unsat_core: reasons,
      fallback_reason: context.fallbackReason ?? null
    };
  }

  return {
    allowed: true,
    summary: {
      order_notional_usd: orderNotional,
      daily_notional_after_usd: dailyAfter,
      portfolio_exposure_after_usd: exposureAfter
    },
    fallback_reason: context.fallbackReason ?? null
  };
}

function asSet(values) {
  return new Set((values ?? []).map((value) => String(value)));
}

export class FormalVerifier {
  constructor({
    mode = "strict",
    pythonPath = "python",
    scriptPath = resolve(process.cwd(), "python/formal_verify.py")
  } = {}) {
    this.mode = mode;
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
  }

  async verify(envelope, policy) {
    if (this.mode === "js") {
      return verifyWithJs(envelope, policy);
    }

    const pythonResult = await this.#runPython({ envelope, policy });
    if (pythonResult.ok) {
      return pythonResult.payload;
    }

    if (this.mode === "fallback") {
      return verifyWithJs(envelope, policy, {
        fallbackReason: pythonResult.error
      });
    }

    return {
      allowed: false,
      code: "formal_verifier_unavailable",
      reasons: [pythonResult.error]
    };
  }

  #runPython(payload) {
    return new Promise((resolvePromise) => {
      let child;
      try {
        child = spawn(this.pythonPath, [this.scriptPath], {
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (error) {
        resolvePromise({
          ok: false,
          error: `unable to launch formal verifier: ${error.message}`
        });
        return;
      }

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        resolvePromise({
          ok: false,
          error: `unable to launch formal verifier: ${error.message}`
        });
      });

      child.on("close", (code) => {
        if (!stdout.trim()) {
          resolvePromise({
            ok: false,
            error: stderr.trim() || `formal verifier exited with code ${code}`
          });
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          resolvePromise({
            ok: true,
            payload: parsed
          });
        } catch (error) {
          resolvePromise({
            ok: false,
            error:
              stderr.trim() ||
              `formal verifier returned invalid JSON: ${error.message}`
          });
        }
      });

      child.stdin.end(JSON.stringify(payload));
    });
  }
}
