import { definePluginEntry } from "file:///usr/local/lib/node_modules/openclaw/dist/plugin-sdk/core.js";

import { createOpenClawTradeTool } from "file:///app/src/index.js";

export default definePluginEntry({
  id: "armorclaw-financial-guard",
  name: "ArmorClaw Financial Guard",
  description:
    "Registers a guarded alpaca.place_order tool that routes paper-trading intents through the Claw-Trade ArmorClaw pipeline.",
  register(api) {
    api.registerTool(
      (toolContext) => createOpenClawTradeTool({ toolContext }),
      { name: "alpaca.place_order" }
    );
  }
});
