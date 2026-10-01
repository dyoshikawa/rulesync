import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AugmentcodePluginHooks } from "./augmentcode-plugin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = ({ testDir, config }: { testDir: string; config: unknown }) =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("AugmentcodePluginHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should write hooks.json under the plugin hooks directory", () => {
      expect(AugmentcodePluginHooks.getSettablePaths()).toEqual({
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should be deletable because rulesync owns the whole plugin hooks file", () => {
      const hooks = AugmentcodePluginHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit PascalCase events, millisecond timeouts and plugin-root-anchored scripts", async () => {
      const pluginHooks = await AugmentcodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          testDir,
          config: {
            version: 1,
            hooks: {
              postToolUse: [
                { type: "command", matcher: "str-replace-editor", command: "./hooks/format.sh" },
              ],
              stop: [{ type: "command", command: "echo done", timeout: 5 }],
            },
          },
        }),
        validate: false,
      });

      expect(JSON.parse(pluginHooks.getFileContent())).toEqual({
        hooks: {
          PostToolUse: [
            {
              matcher: "str-replace-editor",
              hooks: [{ type: "command", command: '"$AUGMENT_PLUGIN_ROOT"/hooks/format.sh' }],
            },
          ],
          Stop: [{ hooks: [{ type: "command", command: "echo done", timeout: 5000 }] }],
        },
      });
    });

    it("should use the braced placeholder Auggie substitutes itself for the exec form", async () => {
      const pluginHooks = await AugmentcodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          testDir,
          config: {
            version: 1,
            hooks: {
              sessionStart: [{ type: "command", command: "./hooks/start.sh", args: ["--quiet"] }],
            },
          },
        }),
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0]).toEqual({
        type: "command",
        command: "${AUGMENT_PLUGIN_ROOT}/hooks/start.sh",
        args: ["--quiet"],
      });
    });

    it("should read the augmentcode override block", async () => {
      const pluginHooks = await AugmentcodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          testDir,
          config: {
            version: 1,
            hooks: {},
            augmentcode: {
              hooks: { sessionStart: [{ type: "command", command: "echo override" }] },
            },
          },
        }),
        validate: false,
      });

      expect(pluginHooks.getFileContent()).toContain("echo override");
    });

    it("should replace an existing hooks.json wholesale", async () => {
      await writeFileContent(
        join(testDir, "hooks", "hooks.json"),
        JSON.stringify({
          hooks: { Stop: [{ hooks: [{ type: "command", command: "echo old" }] }] },
        }),
      );

      const pluginHooks = await AugmentcodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config: { version: 1, hooks: {} } }),
        validate: false,
      });

      expect(JSON.parse(pluginHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should strip the plugin root from documented forms and convert timeouts to seconds", async () => {
      await writeFileContent(
        join(testDir, "hooks", "hooks.json"),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              {
                matcher: "save-file",
                hooks: [
                  {
                    type: "command",
                    command: "${AUGMENT_PLUGIN_ROOT}/hooks/format.sh",
                    timeout: 30000,
                  },
                ],
              },
            ],
            SessionStart: [
              { hooks: [{ type: "command", command: '"$AUGMENT_PLUGIN_ROOT"/hooks/start.sh' }] },
            ],
          },
        }),
      );

      const pluginHooks = await AugmentcodePluginHooks.fromFile({ outputRoot: testDir });
      const json = pluginHooks.toRulesyncHooks().getJson();

      expect(json.hooks.postToolUse).toEqual([
        { type: "command", matcher: "save-file", command: "./hooks/format.sh", timeout: 30 },
      ]);
      expect(json.hooks.sessionStart).toEqual([{ type: "command", command: "./hooks/start.sh" }]);
    });

    it("should treat a missing hooks.json as empty", async () => {
      const pluginHooks = await AugmentcodePluginHooks.fromFile({ outputRoot: testDir });
      expect(pluginHooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should fail closed on unparseable content", () => {
      const pluginHooks = new AugmentcodePluginHooks({
        outputRoot: testDir,
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
        fileContent: "{ not json",
        validate: false,
      });
      expect(() => pluginHooks.toRulesyncHooks()).toThrow(/AugmentCode plugin hooks/);
    });
  });
});
