import { resolve } from "node:path";

import { loadPolicy } from "./config/policy.js";
import { createRuntimeConfig } from "./config/runtime.js";
import { ArmorClawPipeline } from "./pipeline/armorclaw-pipeline.js";

export async function createPipeline(overrides = {}) {
  const config = createRuntimeConfig(overrides);
  const policy = await loadPolicy(config.policyPath);

  return new ArmorClawPipeline({
    policy,
    config: {
      ...config,
      policyPath: resolve(config.policyPath)
    }
  });
}
