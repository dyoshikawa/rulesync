import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodePluginHooks } from "./claudecode-plugin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = ({ testDir, command }: { testDir: string; command: string }) =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify({
      version: 1,
      hooks: { sessionStart: [{ type: "command", command }] },
    }),
    validate: false,
  });

describe("ClaudecodePluginHooks", () => {
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
      expect(ClaudecodePluginHooks.getSettablePaths()).toEqual({
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should resolve bundled hook scripts against the plugin root, not the consumer's project", async () => {
      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, command: "./scripts/fmt.sh" }),
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        '"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh',
      );
      expect(pluginHooks.getFileContent()).not.toContain("CLAUDE_PROJECT_DIR");
    });

    it("should use the braced placeholder for the exec form, which has no shell to strip quotes", async () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", command: "./scripts/fmt.sh", args: [] }],
          },
        }),
        validate: false,
      });

      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        "${CLAUDE_PLUGIN_ROOT}/scripts/fmt.sh",
      );
    });

    it.each([
      // The script a script runner runs ships with the plugin.
      ["node ./scripts/check.js", 'node "$CLAUDE_PLUGIN_ROOT"/scripts/check.js'],
      ["uv run ./x.py", 'uv run "$CLAUDE_PLUGIN_ROOT"/x.py'],
      // A data argument keeps pointing into the consumer's project.
      ["npx prettier --write ./src", "npx prettier --write ./src"],
      ["./scripts/fmt.sh ./src", '"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh ./src'],
    ])("should generate %s as %s", async (command, expected) => {
      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, command }),
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(expected);
    });

    it("should leave a command that already starts with a variable untouched", async () => {
      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          testDir,
          command: "$CLAUDE_PROJECT_DIR/scripts/consumer-side.sh",
        }),
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        "$CLAUDE_PROJECT_DIR/scripts/consumer-side.sh",
      );
    });

    it("should inherit the Claude Code matcher rules, keeping DirectoryAdded's matcher", async () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            directoryAdded: [
              { type: "command", command: "./scripts/added.sh", matcher: "register_repo_root" },
            ],
            taskCreated: [{ type: "command", command: "./scripts/task.sh", matcher: "Bash" }],
          },
        }),
        validate: false,
      });

      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(pluginHooks.getFileContent());
      expect(parsed.hooks.DirectoryAdded[0].matcher).toBe("register_repo_root");
      // `taskCreated` is still a no-matcher event, so its matcher is dropped.
      expect(parsed.hooks.TaskCreated[0].matcher).toBeUndefined();
    });

    it("should replace previous plugin hooks even when preserveUnowned is set", async () => {
      await ensureDir(join(testDir, "hooks"));
      await writeFileContent(
        join(testDir, "hooks", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: '"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh' },
                  { type: "command", command: "other-tool-hook plugin" },
                ],
              },
            ],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", command: "./scripts/fmt.sh" }] },
        }),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await ClaudecodePluginHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            preserveUnowned: true,
            validate: false,
          })
        ).getFileContent(),
      );
      expect(parsed.hooks.SessionStart[0].hooks).toEqual([
        { type: "command", command: '"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh' },
      ]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should round-trip a plugin-root command back to its relative form", async () => {
      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, command: "./scripts/fmt.sh" }),
        validate: false,
      });

      const roundTripped = new ClaudecodePluginHooks({
        outputRoot: testDir,
        relativeDirPath: "hooks",
        relativeFilePath: "hooks.json",
        fileContent: pluginHooks.getFileContent(),
        validate: false,
      }).toRulesyncHooks();

      const config = JSON.parse(roundTripped.getFileContent());
      expect(config.hooks.sessionStart[0].command).toBe("./scripts/fmt.sh");
    });

    it("should also recognize the braced ${CLAUDE_PLUGIN_ROOT} form used by the exec form", () => {
      const fileContent = JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "${CLAUDE_PLUGIN_ROOT}/scripts/fmt.sh",
                  args: [],
                },
              ],
            },
          ],
        },
      });

      const config = JSON.parse(
        new ClaudecodePluginHooks({
          outputRoot: testDir,
          relativeDirPath: "hooks",
          relativeFilePath: "hooks.json",
          fileContent,
          validate: false,
        })
          .toRulesyncHooks()
          .getFileContent(),
      );

      expect(config.hooks.sessionStart[0].command).toBe("./scripts/fmt.sh");
    });

    // https://github.com/dyoshikawa/rulesync/issues/3171 — an interpreter-led
    // command must keep resolving its script against the plugin root after an
    // import and a generate, or the plugin points into the consumer's project.
    it.each([
      [
        "node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js",
        "node ./scripts/x.js",
        'node "$CLAUDE_PLUGIN_ROOT"/scripts/x.js',
      ],
      [
        'python3 "$CLAUDE_PLUGIN_ROOT/scripts/x.py"',
        'python3 "./scripts/x.py"',
        'python3 "$CLAUDE_PLUGIN_ROOT/scripts/x.py"',
      ],
    ])("should round-trip %s through import and generate", async (command, canonical, expected) => {
      const importCommand = (fileCommand: string): string =>
        JSON.parse(
          new ClaudecodePluginHooks({
            outputRoot: testDir,
            relativeDirPath: "hooks",
            relativeFilePath: "hooks.json",
            fileContent: JSON.stringify({
              hooks: { SessionStart: [{ hooks: [{ type: "command", command: fileCommand }] }] },
            }),
            validate: false,
          })
            .toRulesyncHooks()
            .getFileContent(),
        ).hooks.sessionStart[0].command;

      expect(importCommand(command)).toBe(canonical);

      const pluginHooks = await ClaudecodePluginHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, command: canonical }),
        validate: false,
      });
      const regenerated: string = JSON.parse(pluginHooks.getFileContent()).hooks.SessionStart[0]
        .hooks[0].command;
      expect(regenerated).toBe(expected);
      expect(importCommand(regenerated)).toBe(canonical);
    });
  });
});
