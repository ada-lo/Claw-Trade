import { asArray } from "../common/object-path.js";

function isoDayKey(value) {
  return value.toISOString().slice(0, 10);
}

export class BehavioralMonitor {
  constructor(policy, clock = () => new Date()) {
    this.policy = policy;
    this.clock = clock;
    this.actorState = new Map();
  }

  #getActorState(actorId) {
    if (!this.actorState.has(actorId)) {
      this.actorState.set(actorId, {
        events: [],
        tickersByDay: new Map(),
        cooldownUntil: null
      });
    }

    return this.actorState.get(actorId);
  }

  #prune(state, now) {
    state.events = state.events.filter(
      (event) => now.getTime() - event.timestamp.getTime() <= 60_000
    );
  }

  evaluate(envelope) {
    const state = this.#getActorState(envelope.actor_id);
    const now = new Date(envelope.created_at ?? this.clock().toISOString());
    const behaviorPolicy = this.policy.behavior_monitor ?? {};
    const reasons = [];

    this.#prune(state, now);

    if (state.cooldownUntil && now < state.cooldownUntil) {
      reasons.push(
        `Behavioral cooldown active until ${state.cooldownUntil.toISOString()}.`
      );
    }

    const externalRecent = Number(envelope.state?.prior_trade_count_1m ?? 0);
    const projectedCallCount = state.events.length + externalRecent + 1;
    if (projectedCallCount > (behaviorPolicy.max_tool_calls_per_minute ?? 0)) {
      reasons.push(
        `Projected tool-call rate ${projectedCallCount}/minute exceeds configured limit.`
      );
      const cooldownSeconds = behaviorPolicy.cooldown_seconds ?? 60;
      state.cooldownUntil = new Date(now.getTime() + cooldownSeconds * 1000);
    }

    if (envelope.intent?.type === "trade") {
      const dayKey = isoDayKey(now);
      const todayTickers = new Set(state.tickersByDay.get(dayKey) ?? []);
      for (const ticker of asArray(envelope.state?.focused_tickers)) {
        todayTickers.add(String(ticker));
      }
      todayTickers.add(String(envelope.intent.ticker));

      if (
        todayTickers.size >
        (behaviorPolicy.max_distinct_tickers_per_day ?? Number.POSITIVE_INFINITY)
      ) {
        reasons.push(
          `Projected distinct ticker count ${todayTickers.size} exceeds daily baseline.`
        );
      }

      const baselineTickers = new Set(
        asArray(behaviorPolicy.baseline_tickers).map((value) => String(value))
      );
      const requiredSources =
        behaviorPolicy.require_extra_confirmation_sources_for_unusual_tickers ?? 3;
      if (
        baselineTickers.size > 0 &&
        !baselineTickers.has(String(envelope.intent.ticker)) &&
        asArray(envelope.evidence?.sources).length < requiredSources
      ) {
        reasons.push(
          `Ticker ${envelope.intent.ticker} is outside the behavioral baseline and lacks corroborating evidence.`
        );
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      snapshot: {
        recent_call_count: state.events.length,
        cooldown_until: state.cooldownUntil?.toISOString() ?? null
      }
    };
  }

  record(envelope) {
    const state = this.#getActorState(envelope.actor_id);
    const now = new Date(envelope.created_at ?? this.clock().toISOString());
    const dayKey = isoDayKey(now);

    state.events.push({
      timestamp: now,
      ticker: envelope.intent?.ticker ?? null
    });
    this.#prune(state, now);

    if (envelope.intent?.type === "trade" && envelope.intent?.ticker) {
      const tickers = new Set(state.tickersByDay.get(dayKey) ?? []);
      tickers.add(String(envelope.intent.ticker));
      state.tickersByDay.set(dayKey, [...tickers]);
    }
  }
}
