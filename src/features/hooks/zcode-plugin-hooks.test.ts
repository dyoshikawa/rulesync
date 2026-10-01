import { describe, expect, it } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ZcodePluginHooks } from "./zcode-plugin-hooks.js";

const buildRulesyncHooks = (hooks: Record<string, unknown>) =>
  new RulesyncHooks({
    outputRoot: ".",
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify({ version: 1, hooks }),
    validate: false,
  });

const buildPluginHooks = (content: unknown) =>
  new ZcodePluginHooks({
    outputRoot: ".",
    relativeDirPath: "hooks",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(content),
  });

describe("ZcodePluginHooks", () => {
  it("writes hooks.json under the plugin hooks directory", () => {
    expect(ZcodePluginHooks.getSettablePaths()).toEqual({
      relativeDirPath: "hooks",
      relativeFilePath: "hooks.json",
    });
  });

  it("writes the event map directly under hooks and anchors bundled scripts to the plugin root", async () => {
    const pluginHooks = await ZcodePluginHooks.fromRulesyncHooks({
      outputRoot: ".",
      rulesyncHooks: buildRulesyncHooks({
        sessionStart: [{ type: "command", command: "./scripts/setup.sh" }],
        preToolUse: [{ type: "command", command: "npx prettier --check .", matcher: "Bash" }],
      }),
    });

    expect(JSON.parse(pluginHooks.getFileContent())).toEqual({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: '"$ZCODE_PLUGIN_ROOT"/scripts/setup.sh' }] },
        ],
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "npx prettier --check ." }] },
        ],
      },
    });
  });

  it("round-trips an anchored script back to a relative command", () => {
    const rulesyncHooks = buildPluginHooks({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: '"$ZCODE_PLUGIN_ROOT"/scripts/setup.sh' }] },
        ],
      },
    }).toRulesyncHooks();

    expect(rulesyncHooks.getJson().hooks).toEqual({
      sessionStart: [{ type: "command", command: "./scripts/setup.sh" }],
    });
  });

  it("skips process hooks on import with a warning", () => {
    const logger = createMockLogger();

    const rulesyncHooks = buildPluginHooks({
      hooks: {
        Stop: [{ hooks: [{ type: "process", command: "node", args: ["done.js"] }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }).toRulesyncHooks({ logger });

    expect(rulesyncHooks.getJson().hooks).toEqual({
      sessionStart: [{ type: "command", command: "echo hi" }],
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"process" hook'));
  });

  it("is deletable, since the plugin bundle is generated in full", () => {
    expect(
      ZcodePluginHooks.forDeletion({
        outputRoot: ".",
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
      }).isDeletable(),
    ).toBe(true);
  });
});
