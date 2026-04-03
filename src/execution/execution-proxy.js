export class ExecutionProxy {
  constructor({
    policy,
    signer,
    nonceStore,
    adapter,
    executionMode = "dry-run"
  }) {
    this.policy = policy;
    this.signer = signer;
    this.nonceStore = nonceStore;
    this.adapter = adapter;
    this.executionMode = executionMode;
  }

  async execute(signedIntent) {
    const reasons = [];

    if (this.policy.execution_proxy?.require_signature && !this.signer.verify(signedIntent)) {
      reasons.push("Cryptographic signature verification failed.");
    }

    const nonce = signedIntent.payload?.envelope?.nonce;
    if (!nonce) {
      reasons.push("Signed intent is missing a nonce.");
    }

    if (reasons.length === 0 && this.policy.execution_proxy?.require_unique_nonce) {
      const unique = await this.nonceStore.ensureUnique(nonce, {
        actor_id: signedIntent.payload?.envelope?.actor_id ?? "unknown"
      });
      if (!unique) {
        reasons.push(`Replay protection blocked duplicate nonce ${nonce}.`);
      }
    }

    if (reasons.length > 0) {
      return {
        allowed: false,
        blocked_by: "execution_proxy",
        reasons
      };
    }

    try {
      const execution = await this.adapter.executeTrade(
        signedIntent.payload.envelope.intent
      );
      return {
        allowed: true,
        execution
      };
    } catch (error) {
      return {
        allowed: false,
        blocked_by: "execution_proxy",
        reasons: [error.message]
      };
    }
  }
}
