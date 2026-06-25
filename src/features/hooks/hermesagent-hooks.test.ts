import { describe, expect, it } from "vitest";

import { parseHermesConfig } from "../hermes-config.js";
import { HermesagentHooks } from "./hermesagent-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("HermesagentHooks", () => {
  it("preserves existing Hermes config when writing hooks", async () => {
    const rulesyncHooks = new RulesyncHooks({
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {
          preToolUse: {
            command: "pnpm lint",
          },
        },
      }),
    });

    const hooks = await HermesagentHooks.fromRulesyncHooks({
      outputRoot: ".",
      rulesyncHooks,
    });

    hooks.setFileContent(`model: hermes-3
mcp_servers:
  docs:
    url: https://example.com/mcp
hooks:
  rulesync:
    stale: true
`);

    const config = parseHermesConfig(hooks.getFileContent());
    expect(config.model).toBe("hermes-3");
    expect(config.mcp_servers).toEqual({
      docs: { url: "https://example.com/mcp" },
    });
    expect(config.hooks).toEqual({
      rulesync: {
        hooks: {
          preToolUse: {
            command: "pnpm lint",
          },
        },
      },
    });
  });
});
