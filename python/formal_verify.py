from __future__ import annotations

import json
import sys


def emit(payload: dict, exit_code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload))
    return exit_code


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        return emit(
            {
                "allowed": False,
                "code": "empty_input",
                "reasons": ["formal verifier received no input"]
            },
            1,
        )

    data = json.loads(raw)
    envelope = data["envelope"]
    policy = data["policy"]
    intent = envelope["intent"]
    state = envelope.get("state", {})
    risk_limits = policy.get("risk_limits", {})
    market = policy.get("market", {})

    try:
        import z3
    except Exception as exc:  # pragma: no cover - environment specific
        return emit(
            {
                "allowed": False,
                "code": "formal_verifier_unavailable",
                "reasons": [f"z3-solver is unavailable: {exc}"]
            },
            2,
        )

    solver = z3.Solver()

    quantity = int(intent.get("quantity", 0))
    limit_price = float(intent.get("limit_price", 0))
    current_daily_notional = float(state.get("current_daily_notional_usd", 0))
    current_portfolio_exposure = float(
        state.get("current_portfolio_exposure_usd", 0)
    )
    ticker = intent.get("ticker", "")
    asset_class = intent.get("asset_class", "")

    quantity_var = z3.Int("quantity")
    price_var = z3.Real("limit_price")
    market_open = z3.Bool("market_hours_open")
    order_notional = z3.Real("order_notional")
    daily_after = z3.Real("daily_after")
    exposure_after = z3.Real("exposure_after")
    ticker_var = z3.String("ticker")
    asset_class_var = z3.String("asset_class")

    def tracked(label: str, clause: z3.BoolRef) -> None:
        solver.assert_and_track(clause, label)

    tracked("quantity_positive", quantity_var > 0)
    tracked("limit_price_positive", price_var > 0)
    tracked("market_hours_open", market_open == bool(state.get("market_hours_open", False)))
    tracked("bind_quantity", quantity_var == quantity)
    tracked("bind_price", price_var == z3.RealVal(str(limit_price)))
    tracked("bind_ticker", ticker_var == z3.StringVal(ticker))
    tracked("bind_asset_class", asset_class_var == z3.StringVal(asset_class))
    tracked("bind_order_notional", order_notional == quantity_var * price_var)
    tracked(
        "bind_daily_after",
        daily_after == order_notional + z3.RealVal(str(current_daily_notional)),
    )
    tracked(
        "bind_exposure_after",
        exposure_after
        == order_notional + z3.RealVal(str(current_portfolio_exposure)),
    )
    tracked(
        "single_order_limit",
        order_notional
        <= z3.RealVal(str(risk_limits.get("max_single_order_notional_usd", 0))),
    )
    tracked(
        "daily_limit",
        daily_after
        <= z3.RealVal(str(risk_limits.get("max_daily_notional_usd", 0))),
    )
    tracked(
        "portfolio_exposure_limit",
        exposure_after
        <= z3.RealVal(str(risk_limits.get("max_portfolio_exposure_usd", 0))),
    )
    tracked(
        "share_limit",
        quantity_var <= int(risk_limits.get("max_shares_per_order", 0)),
    )

    allowed_tickers = market.get("allowed_tickers", [])
    if allowed_tickers:
        tracked(
            "ticker_allowlist",
            z3.Or([ticker_var == z3.StringVal(value) for value in allowed_tickers]),
        )

    allowed_asset_classes = market.get("allowed_asset_classes", [])
    if allowed_asset_classes:
        tracked(
            "asset_class_allowlist",
            z3.Or(
                [asset_class_var == z3.StringVal(value) for value in allowed_asset_classes]
            ),
        )

    if market.get("market_hours_only", True):
        tracked("market_session_gate", market_open)

    status = solver.check()
    if status == z3.unsat:
        return emit(
            {
                "allowed": False,
                "code": "unsat",
                "reasons": [
                    "formal verification rejected the proposed action"
                ],
                "unsat_core": [str(item) for item in solver.unsat_core()],
            }
        )

    return emit(
        {
            "allowed": True,
            "summary": {
                "order_notional_usd": quantity * limit_price,
                "daily_notional_after_usd": current_daily_notional + quantity * limit_price,
                "portfolio_exposure_after_usd": current_portfolio_exposure
                + quantity * limit_price,
            }
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
