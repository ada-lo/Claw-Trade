import { readFileSync } from "node:fs";
import vm from "node:vm";

const text = readFileSync(new URL("../openclaw.json5", import.meta.url), "utf8");
const config = vm.runInNewContext(`(${text})`);

process.stdout.write(
  JSON.stringify(
    {
      topLevelKeys: Object.keys(config),
      agentCount: config.agents?.list?.length ?? 0,
      globalDeny: config.tools?.deny ?? [],
      sandboxMode: config.agents?.defaults?.sandbox?.mode ?? null,
      trustedProxies: config.gateway?.trustedProxies ?? []
    },
    null,
    2
  )
);
