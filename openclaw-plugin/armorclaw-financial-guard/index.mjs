import { definePluginEntry } from "file:///usr/local/lib/node_modules/openclaw/dist/plugin-sdk/core.js";

import { beforeToolCall, createOpenClawTradeTool } from "file:///app/src/index.js";

export default definePluginEntry({
  id: "armorclaw-financial-guard",
  name: "ArmorClaw Financial Guard",
  description:
    "Registers a guarded alpaca.place_order tool that routes paper-trading intents through the Claw-Trade ArmorClaw pipeline.",
  register(api) {
    api.registerHook(
      "before_tool_call",
      async (event, toolContext) => beforeToolCall(event, toolContext),
      {
        name: "armorclaw-financial-guard.before-tool-call",
        description:
          "Blocks out-of-policy alpaca.place_order calls before execution."
      }
    );

    api.registerTool(
      (toolContext) => createOpenClawTradeTool({ toolContext }),
      { name: "alpaca.place_order" }
    );
  }
});
