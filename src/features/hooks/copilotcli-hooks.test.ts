import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliHooks } from "./copilotcli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("CopilotcliHooks", () => {
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
    it("should return .github/hooks/copilotcli-hooks.json in project mode", () => {
      const paths = CopilotcliHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
      });
    });

    it("should return .copilot/hooks/copilot-hooks.json in global mode", () => {
      const paths = CopilotcliHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".copilot", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should serialize supported events to copilotcli-hooks.json", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo session-start" }],
          beforeSubmitPrompt: [{ command: "echo prompt" }],
          // matchers are unsupported and dropped
          preToolUse: [{ matcher: "Edit|Write", command: "echo skipped" }],
          // unsupported event for copilot — also dropped
          notification: [{ command: "echo skipped" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.userPromptSubmitted).toBeDefined();
      // matcher entry was dropped, so preToolUse must not exist
      expect(parsed.hooks.preToolUse).toBeUndefined();
      // unsupported event must not leak through
      expect(parsed.hooks.notification).toBeUndefined();
    });

    it("should let copilotcli.hooks override copilot.hooks override shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "shared" }],
        },
        copilot: {
          hooks: {
            sessionStart: [{ command: "copilot-shared" }],
          },
        },
        copilotcli: {
          hooks: {
            sessionStart: [{ command: "cli-only" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const hooks = await CopilotcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const parsed = JSON.parse(hooks.getFileContent());
      const stringified = JSON.stringify(parsed.hooks);
      expect(stringified).toContain("cli-only");
      expect(stringified).not.toContain("copilot-shared");
      expect(stringified).not.toContain('"shared"');
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert copilotcli-hooks.json back to canonical format", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", bash: "echo a", timeoutSec: 30 }],
            errorOccurred: [{ type: "command", bash: "echo b" }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = hooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo a");
      expect(json.hooks.sessionStart?.[0]?.timeout).toBe(30);
      expect(json.hooks.afterError?.[0]?.command).toBe("echo b");
    });

    it("should default missing 'type' field to 'command' when importing", () => {
      const hooks = new CopilotcliHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            // hand-edited entry omitting `type`
            sessionStart: [{ bash: "echo no-type" }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo no-type");
    });
  });

  describe("fromFile", () => {
    it("should load project copilotcli-hooks.json", async () => {
      const dir = join(testDir, ".github", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "copilotcli-hooks.json"),
        JSON.stringify({ version: 1, hooks: { sessionStart: [] } }),
      );

      const hooks = await CopilotcliHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.version).toBe(1);
    });

    it("should load global copilot-hooks.json from .copilot/hooks", async () => {
      const dir = join(testDir, ".copilot", "hooks");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "copilot-hooks.json"),
        JSON.stringify({ version: 1, hooks: {} }),
      );

      const hooks = await CopilotcliHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });
      expect(hooks.getRelativeDirPath()).toBe(join(".copilot", "hooks"));
      expect(hooks.getRelativeFilePath()).toBe("copilot-hooks.json");
    });

    it("should return default content when file does not exist", async () => {
      const hooks = await CopilotcliHooks.fromFile({ outputRoot: testDir, validate: false });
      expect(hooks.getFileContent()).toBe('{"hooks":{}}');
    });
  });

  describe("forDeletion", () => {
    it("should return CopilotcliHooks with empty hooks", () => {
      const hooks = CopilotcliHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilotcli-hooks.json",
      });
      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
