import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DeepagentsHooks } from "./deepagents-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("DeepagentsHooks", () => {
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
    it("should return .deepagents/hooks.json", () => {
      const paths = DeepagentsHooks.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".deepagents");
      expect(paths.relativeFilePath).toBe("hooks.json");
    });

    it("should return same path for global mode", () => {
      const paths = DeepagentsHooks.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".deepagents");
      expect(paths.relativeFilePath).toBe("hooks.json");
    });
  });

  describe("isDeletable", () => {
    it("should always return true", () => {
      const hooks = new DeepagentsHooks({
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({ hooks: [] }),
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should load hooks from .deepagents/hooks.json", async () => {
      const deepagentsDir = join(testDir, ".deepagents");
      await ensureDir(deepagentsDir);
      const content = JSON.stringify({
        hooks: [{ command: ["bash", "-c", "echo hello"], events: ["session.start"] }],
      });
      await writeFileContent(join(deepagentsDir, "hooks.json"), content);

      const hooks = await DeepagentsHooks.fromFile({ outputRoot: testDir });
      expect(hooks.getFileContent()).toContain("session.start");
    });

    it("should return empty hooks if file does not exist", async () => {
      const hooks = await DeepagentsHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual([]);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to deepagents flat array format", () => {
      const rulesyncHooksContent = JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo session started" }],
          stop: [{ type: "command", command: "echo task done" }],
        },
      });

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: rulesyncHooksContent,
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(Array.isArray(parsed.hooks)).toBe(true);
      expect(parsed.hooks.length).toBe(2);

      const sessionStartEntry = parsed.hooks.find((h: { events?: string[] }) =>
        h.events?.includes("session.start"),
      );
      expect(sessionStartEntry).toBeDefined();
      expect(sessionStartEntry.command).toEqual(["bash", "-c", "echo session started"]);

      const stopEntry = parsed.hooks.find((h: { events?: string[] }) =>
        h.events?.includes("task.complete"),
      );
      expect(stopEntry).toBeDefined();
      expect(stopEntry.command).toEqual(["bash", "-c", "echo task done"]);
    });

    it("should skip prompt-type hooks", () => {
      const rulesyncHooksContent = JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "prompt", prompt: "Do something" }],
          stop: [{ type: "command", command: "echo done" }],
        },
      });

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: rulesyncHooksContent,
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      // Only the command hook should be present
      expect(parsed.hooks.length).toBe(1);
      expect(parsed.hooks[0].events).toEqual(["task.complete"]);
    });

    it("should skip unsupported canonical events", () => {
      const rulesyncHooksContent = JSON.stringify({
        version: 1,
        hooks: {
          // preToolUse is NOT in DEEPAGENTS_HOOK_EVENTS
          preToolUse: [{ type: "command", command: "echo tool" }],
          sessionStart: [{ type: "command", command: "echo start" }],
        },
      });

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: rulesyncHooksContent,
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.length).toBe(1);
      expect(parsed.hooks[0].events).toEqual(["session.start"]);
    });

    it("should apply deepagents-specific hook overrides", () => {
      const rulesyncHooksContent = JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo shared" }],
        },
        deepagents: {
          hooks: {
            sessionStart: [{ type: "command", command: "echo overridden" }],
          },
        },
      });

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: rulesyncHooksContent,
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      // The override replaces the shared hook for sessionStart
      const sessionEntries = parsed.hooks.filter((h: { events?: string[] }) =>
        h.events?.includes("session.start"),
      );
      expect(sessionEntries.length).toBe(1);
      expect(sessionEntries[0].command[2]).toBe("echo overridden");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert deepagents hooks back to canonical format", () => {
      const deepagentsContent = JSON.stringify({
        hooks: [
          { command: ["bash", "-c", "echo start"], events: ["session.start"] },
          { command: ["bash", "-c", "echo done"], events: ["task.complete"] },
        ],
      });

      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: deepagentsContent,
      });

      const rulesyncHooks = hooks.toRulesyncHooks();
      const canonical = rulesyncHooks.getJson();

      expect(canonical.hooks.sessionStart).toBeDefined();
      expect(canonical.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(canonical.hooks.stop).toBeDefined();
      expect(canonical.hooks.stop?.[0]?.command).toBe("echo done");
    });

    it("should handle hook entry with multiple events", () => {
      const deepagentsContent = JSON.stringify({
        hooks: [
          {
            command: ["bash", "-c", "echo multi"],
            events: ["session.start", "session.end"],
          },
        ],
      });

      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: deepagentsContent,
      });

      const rulesyncHooks = hooks.toRulesyncHooks();
      const canonical = rulesyncHooks.getJson();

      expect(canonical.hooks.sessionStart).toBeDefined();
      expect(canonical.hooks.sessionEnd).toBeDefined();
    });

    it("should skip malformed hook entries", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: [null, "invalid", { events: ["session.start"] }, { command: [] }],
        }),
      });

      const rulesyncHooks = hooks.toRulesyncHooks();

      expect(rulesyncHooks.getJson().hooks).toEqual({});
    });

    it("should join command parts when bash fallback pattern is not used", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: [{ command: ["pnpm", "test", "--runInBand"], events: ["task.complete"] }],
        }),
      });

      const rulesyncHooks = hooks.toRulesyncHooks();

      expect(rulesyncHooks.getJson().hooks.stop).toEqual([
        { type: "command", command: "pnpm test --runInBand" },
      ]);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder hooks file for deletion", () => {
      const hooks = DeepagentsHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
      });

      expect(hooks.getRelativeDirPath()).toBe(".deepagents");
      expect(hooks.getRelativeFilePath()).toBe("hooks.json");
      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: [] });
    });
  });
});
