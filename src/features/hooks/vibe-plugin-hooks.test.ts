import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { RulesyncHooks } from "./rulesync-hooks.js";
import { VibePluginHooks } from "./vibe-plugin-hooks.js";

describe("VibePluginHooks", () => {
  it("writes ai.mistral.vibe/hooks.toml in the .vibe/hooks.toml format", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: ".",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "bash", command: "./scripts/check.sh" }] },
      }),
    });

    const hooks = await VibePluginHooks.fromRulesyncHooks({ outputRoot: ".", rulesyncHooks });

    expect(hooks).toBeInstanceOf(VibePluginHooks);
    expect(hooks.getRelativeDirPath()).toBe("ai.mistral.vibe");
    expect(hooks.getRelativeFilePath()).toBe("hooks.toml");
    expect(smolToml.parse(hooks.getFileContent())).toEqual({
      hooks: [
        expect.objectContaining({
          type: "pre_tool",
          match: "bash",
          command: "./scripts/check.sh",
        }),
      ],
    });

    const imported = hooks.toRulesyncHooks().getJson();
    expect(imported.hooks.preToolUse).toEqual([
      expect.objectContaining({ matcher: "bash", command: "./scripts/check.sh" }),
    ]);
  });
});
