import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class NonceStore {
  constructor(path) {
    this.path = path;
  }

  async #readState() {
    try {
      const contents = await readFile(this.path, "utf8");
      return JSON.parse(contents);
    } catch {
      return { nonces: {} };
    }
  }

  async #writeState(state) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }

  async ensureUnique(nonce, metadata = {}) {
    const state = await this.#readState();
    if (state.nonces[nonce]) {
      return false;
    }

    state.nonces[nonce] = {
      seen_at: new Date().toISOString(),
      ...metadata
    };
    await this.#writeState(state);
    return true;
  }
}
