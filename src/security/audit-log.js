import { createHmac } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { sha256, stableStringify } from "../common/stable-json.js";

export class AuditLog {
  constructor({ path, hmacSecret }) {
    this.path = path;
    this.hmacSecret = hmacSecret;
    this.lastHash = null;
  }

  async #loadLastHash() {
    if (this.lastHash !== null) {
      return this.lastHash;
    }

    try {
      const contents = await readFile(this.path, "utf8");
      const lines = contents
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        this.lastHash = "GENESIS";
        return this.lastHash;
      }

      const record = JSON.parse(lines[lines.length - 1]);
      this.lastHash = record.entry_hash ?? "GENESIS";
      return this.lastHash;
    } catch {
      this.lastHash = "GENESIS";
      return this.lastHash;
    }
  }

  async append(event) {
    await mkdir(dirname(this.path), { recursive: true });
    const previousHash = await this.#loadLastHash();
    const eventBlob = stableStringify(event);
    const entryHash = sha256(`${previousHash}:${eventBlob}`);
    const integrityTag = createHmac("sha256", this.hmacSecret)
      .update(entryHash)
      .digest("hex");

    const record = {
      recorded_at: new Date().toISOString(),
      prev_hash: previousHash,
      entry_hash: entryHash,
      integrity_tag: integrityTag,
      event
    };

    await appendFile(this.path, `${stableStringify(record)}\n`, "utf8");
    this.lastHash = entryHash;
    return record;
  }
}
