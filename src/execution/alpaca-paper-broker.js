export class AlpacaPaperBroker {
  constructor({ baseUrl, apiKey, apiSecret }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async executeTrade(intent) {
    if (!this.baseUrl.includes("paper")) {
      throw new Error("Refusing to trade against a non-paper Alpaca endpoint.");
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Missing Alpaca paper-trading credentials.");
    }

    const body = {
      symbol: intent.ticker,
      side: intent.action,
      qty: String(intent.quantity),
      type: intent.limit_price ? "limit" : "market",
      time_in_force: "day"
    };

    if (intent.limit_price) {
      body.limit_price = Number(intent.limit_price).toFixed(2);
    }

    const response = await fetch(`${this.baseUrl}/v2/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.apiSecret
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Alpaca rejected the paper order with status ${response.status}: ${JSON.stringify(payload)}`
      );
    }

    return {
      broker: "alpaca-paper",
      status: payload.status ?? "submitted",
      order_id: payload.id ?? null,
      response: payload
    };
  }
}
