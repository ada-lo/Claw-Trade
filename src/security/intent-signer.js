import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBuffer,
  verify as verifyBuffer
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { sha256, stableStringify } from "../common/stable-json.js";

export class IntentSigner {
  constructor({
    privateKeyPath = null,
    publicKeyPath = null,
    executionMode = "dry-run"
  } = {}) {
    this.executionMode = executionMode;
    this.keyMode = "ephemeral";

    if (privateKeyPath && publicKeyPath && existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
      this.privateKey = createPrivateKey(readFileSync(privateKeyPath, "utf8"));
      this.publicKey = createPublicKey(readFileSync(publicKeyPath, "utf8"));
      this.keyMode = "file-backed";
      return;
    }

    if (executionMode !== "dry-run") {
      throw new Error(
        "Paper execution requires file-backed Ed25519 keys. Run npm run generate:keys first."
      );
    }

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  sign(payload) {
    const canonicalPayload = stableStringify(payload);
    const signature = signBuffer(
      null,
      Buffer.from(canonicalPayload),
      this.privateKey
    ).toString("base64");

    return {
      algorithm: "ed25519",
      signer_mode: this.keyMode,
      payload,
      payload_hash: sha256(canonicalPayload),
      signature
    };
  }

  verify(signedIntent) {
    const canonicalPayload = stableStringify(signedIntent.payload);
    if (sha256(canonicalPayload) !== signedIntent.payload_hash) {
      return false;
    }

    return verifyBuffer(
      null,
      Buffer.from(canonicalPayload),
      this.publicKey,
      Buffer.from(signedIntent.signature, "base64")
    );
  }
}
