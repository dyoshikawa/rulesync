import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GrokcliHooks } from "./grokcli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("GrokcliHooks", () => {
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

  const makeRulesyncHooks = (config: unknown): RulesyncHooks =>
    new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .grok/hooks and rulesync.json for project mode", () => {
      const paths = GrokcliHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
    });

    it("should use the same relative layout for global mode", () => {
      const paths = GrokcliHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit a Claude-compatible nested map under the top-level hooks key", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "exec", command: "./scripts/check.sh", timeout: 10 }],
          postToolUse: [{ command: "./scripts/after.sh" }],
          beforeSubmitPrompt: [{ command: "./scripts/prompt.sh" }],
          stop: [{ command: "./scripts/stop.sh" }],
          sessionStart: [{ command: "./scripts/start.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      // Everything nests under the top-level `hooks` key.
      expect(parsed.hooks).toBeDefined();
      // PreToolUse keeps its matcher (the only matcher-aware event).
      expect(parsed.hooks.PreToolUse).toEqual([
        {
          matcher: "exec",
          hooks: [{ type: "command", command: "./scripts/check.sh", timeout: 10 }],
        },
      ]);
      // Matcher-less events carry no matcher key.
      expect(parsed.hooks.PostToolUse).toEqual([
        { hooks: [{ type: "command", command: "./scripts/after.sh" }] },
      ]);
      expect(parsed.hooks.UserPromptSubmit).toEqual([
        { hooks: [{ type: "command", command: "./scripts/prompt.sh" }] },
      ]);
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "./scripts/stop.sh" }] },
      ]);
      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "./scripts/start.sh" }] },
      ]);
    });

    it("should drop a matcher on a matcher-less event", async () => {
      const config = {
        version: 1,
        hooks: {
          // `stop` is matcher-less; the matcher must be dropped from the output.
          stop: [{ matcher: "exec", command: "./scripts/stop.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "./scripts/stop.sh" }] },
      ]);
    });

    it("should drop canonical events without a Grok equivalent", async () => {
      const config = {
        version: 1,
        hooks: {
          // Not in the Grok native event set.
          beforeReadFile: [{ command: "read.sh" }],
          afterFileEdit: [{ command: "edit.sh" }],
          preToolUse: [{ command: "tool.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(Object.keys(parsed.hooks)).toEqual(["PreToolUse"]);
    });

    it("should merge config.grokcli.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared.sh" }],
        },
        grokcli: {
          hooks: {
            preToolUse: [{ command: "override.sh" }],
            stop: [{ command: "override-stop.sh" }],
          },
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toEqual([
        { hooks: [{ type: "command", command: "override.sh" }] },
      ]);
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "override-stop.sh" }] },
      ]);
    });
  });

  describe("fromFile", () => {
    it("should parse an existing project rulesync.json", async () => {
      const dir = join(testDir, ".grok", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "rulesync.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "s.sh" }] }],
          },
        }),
      );

      const grokHooks = await GrokcliHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(grokHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
    });

    it("should fall back to an empty hooks object when the file is missing", async () => {
      const grokHooks = await GrokcliHooks.fromFile({ outputRoot: testDir });
      expect(JSON.parse(grokHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map Grok events back to canonical names", () => {
      const fileContent = JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "tool.sh" }] }],
          Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
        },
      });
      const grokHooks = new GrokcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
        fileContent,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.toRulesyncHooks().getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.preToolUse).toEqual([
        { type: "command", command: "tool.sh", matcher: "exec" },
      ]);
      expect(parsed.hooks.stop).toEqual([{ type: "command", command: "stop.sh" }]);
    });

    it("should round-trip every mappable event through fromRulesyncHooks and back", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "start.sh" }],
          sessionEnd: [{ type: "command", command: "end.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          preToolUse: [{ type: "command", command: "tool.sh", matcher: "exec" }],
          // matcher must survive the round-trip on the tool-name events too.
          postToolUse: [{ type: "command", command: "after.sh", matcher: "Write" }],
          postToolUseFailure: [{ type: "command", command: "fail.sh", matcher: "Bash" }],
          permissionDenied: [{ type: "command", command: "denied.sh", matcher: "Edit" }],
          stop: [{ type: "command", command: "stop.sh" }],
          stopFailure: [{ type: "command", command: "stop-failure.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          subagentStart: [{ type: "command", command: "sub-start.sh" }],
          subagentStop: [{ type: "command", command: "sub-stop.sh" }],
          preCompact: [{ type: "command", command: "pre-compact.sh" }],
          postCompact: [{ type: "command", command: "post-compact.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const grokHooks = await GrokcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(grokHooks.toRulesyncHooks().getFileContent());
      expect(parsed.hooks).toEqual(config.hooks);
    });

    it("should throw on invalid JSON content", () => {
      const grokHooks = new GrokcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
        fileContent: "{ not json",
        validate: false,
      });

      expect(() => grokHooks.toRulesyncHooks()).toThrow(/Failed to parse Grok hooks/);
    });
  });

  describe("forDeletion", () => {
    it("should produce an empty hooks object", () => {
      const grokHooks = GrokcliHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".grok", "hooks"),
        relativeFilePath: "rulesync.json",
      });
      expect(JSON.parse(grokHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
