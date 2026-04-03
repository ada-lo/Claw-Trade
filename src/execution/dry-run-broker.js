import { randomUUID } from "node:crypto";

export class DryRunBroker {
  async executeTrade(intent) {
    return {
      broker: "dry-run",
      status: "accepted",
      simulated: true,
      order_id: `dryrun-${randomUUID()}`,
      submitted_at: new Date().toISOString(),
      request: {
        ticker: intent.ticker,
        action: intent.action,
        quantity: intent.quantity,
        limit_price: intent.limit_price
      }
    };
  }
}
