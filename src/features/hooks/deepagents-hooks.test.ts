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
        fileContent: JSON.stringify({ hooks: {} }),
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should load hooks from .deepagents/hooks.json", async () => {
      const deepagentsDir = join(testDir, ".deepagents");
      await ensureDir(deepagentsDir);
      const content = JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
        },
      });
      await writeFileContent(join(deepagentsDir, "hooks.json"), content);

      const hooks = await DeepagentsHooks.fromFile({ outputRoot: testDir });
      expect(hooks.getFileContent()).toContain("SessionStart");
    });

    it("should return empty hooks if file does not exist", async () => {
      const hooks = await DeepagentsHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to the Hooks v2 document", () => {
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

      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "echo session started" }] },
      ]);
      expect(parsed.hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "echo task done" }] },
      ]);
    });

    it("should emit matchers as v2 matcher groups", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [
              { type: "command", command: "echo bash tool", matcher: "Bash" },
              { type: "command", command: "echo any tool" },
            ],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "echo bash tool" }] },
        { hooks: [{ type: "command", command: "echo any tool" }] },
      ]);
    });

    it("should group handlers sharing an event and matcher in authored order", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [
              { type: "command", command: "echo first", matcher: "Bash" },
              { type: "command", command: "echo second", matcher: "Bash" },
            ],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "echo first" },
            { type: "command", command: "echo second" },
          ],
        },
      ]);
    });

    it("should carry timeout and statusMessage onto the handler", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [
              { type: "command", command: "echo guarded", timeout: 30, statusMessage: "Checking" },
            ],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.PreToolUse).toEqual([
        {
          hooks: [
            { type: "command", command: "echo guarded", timeout: 30, statusMessage: "Checking" },
          ],
        },
      ]);
    });

    it("should omit a non-positive timeout upstream would reject", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [{ type: "command", command: "echo zero", timeout: 0 }],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.PreToolUse).toEqual([
        { hooks: [{ type: "command", command: "echo zero" }] },
      ]);
    });

    it("should map the canonical notification event to the v2 Notification event", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            notification: [
              { type: "command", command: "echo needs input", matcher: "agent_needs_input" },
            ],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.Notification).toEqual([
        { matcher: "agent_needs_input", hooks: [{ type: "command", command: "echo needs input" }] },
      ]);
    });

    it("should map the subagent lifecycle events v2 added", () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            subagentStart: [{ type: "command", command: "echo spawn" }],
            subagentStop: [{ type: "command", command: "echo subagent done" }],
          },
        }),
      });

      const hooks = DeepagentsHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
      const parsed = JSON.parse(hooks.getFileContent());

      expect(parsed.hooks.SubagentStart).toBeDefined();
      expect(parsed.hooks.SubagentStop).toBeDefined();
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

      expect(Object.keys(parsed.hooks)).toEqual(["Stop"]);
    });

    it("should skip unsupported canonical events", () => {
      const rulesyncHooksContent = JSON.stringify({
        version: 1,
        hooks: {
          // contextOffload has no Hooks v2 counterpart
          contextOffload: [{ type: "command", command: "echo offloaded" }],
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

      expect(Object.keys(parsed.hooks)).toEqual(["SessionStart"]);
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
      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "echo overridden" }] },
      ]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert v2 hooks back to canonical format", () => {
      const deepagentsContent = JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
        },
      });

      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: deepagentsContent,
      });

      const rulesyncHooks = hooks.toRulesyncHooks();
      const canonical = rulesyncHooks.getJson();

      expect(canonical.hooks.sessionStart).toEqual([{ type: "command", command: "echo start" }]);
      expect(canonical.hooks.stop).toEqual([{ type: "command", command: "echo done" }]);
    });

    it("should round-trip matcher, timeout and statusMessage", () => {
      const deepagentsContent = JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "echo guarded", timeout: 15, statusMessage: "Guard" },
              ],
            },
          ],
        },
      });

      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: deepagentsContent,
      });

      const canonical = hooks.toRulesyncHooks().getJson();

      expect(canonical.hooks.preToolUse).toEqual([
        {
          type: "command",
          command: "echo guarded",
          matcher: "Bash",
          timeout: 15,
          statusMessage: "Guard",
        },
      ]);
    });

    it("should skip malformed groups and handlers", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [null, "invalid", { hooks: "nope" }, { hooks: [{ type: "command" }] }],
            UnknownEvent: [{ hooks: [{ type: "command", command: "echo ignored" }] }],
          },
        }),
      });

      const rulesyncHooks = hooks.toRulesyncHooks();

      expect(rulesyncHooks.getJson().hooks).toEqual({});
    });

    it("should drop a v2 event named toString instead of keying by Object.prototype.toString (#2757)", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        // JSON.parse yields an own enumerable `toString` key, unlike an object
        // literal whose `toString` the lookup map would inherit from
        // Object.prototype.
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
            toString: [{ hooks: [{ type: "command", command: "echo crafted" }] }],
          },
        }),
      });

      const canonical = hooks.toRulesyncHooks().getJson();

      expect(canonical.hooks.sessionStart).toEqual([{ type: "command", command: "echo start" }]);
      // deepagents only imports events it maps, so the unmapped name is dropped
      // like any other unknown event rather than resolving to
      // Object.prototype.toString and landing under its stringified source.
      expect(Object.keys(canonical.hooks)).toEqual(["sessionStart"]);
      expect((canonical as { deepagents?: unknown }).deepagents).toBeUndefined();
    });

    it("should import the pre-v2 flat list format", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: [
            { command: ["bash", "-c", "echo start"], events: ["session.start"] },
            { command: ["bash", "-c", "echo multi"], events: ["session.start", "session.end"] },
            { command: ["pnpm", "test", "--runInBand"], events: ["task.complete"] },
          ],
        }),
      });

      const canonical = hooks.toRulesyncHooks().getJson();

      expect(canonical.hooks.sessionStart).toEqual([
        { type: "command", command: "echo start" },
        { type: "command", command: "echo multi" },
      ]);
      expect(canonical.hooks.sessionEnd).toEqual([{ type: "command", command: "echo multi" }]);
      expect(canonical.hooks.stop).toEqual([{ type: "command", command: "pnpm test --runInBand" }]);
    });

    it("should drop a legacy event named toString instead of keying by Object.prototype.toString (#2757)", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: [{ command: ["bash", "-c", "echo start"], events: ["session.start", "toString"] }],
        }),
      });

      const canonical = hooks.toRulesyncHooks().getJson();

      expect(canonical.hooks.sessionStart).toEqual([{ type: "command", command: "echo start" }]);
      // The legacy event list is filtered the same way as the v2 record: an
      // unmapped name is dropped, never resolved through the lookup map's
      // prototype.
      expect(Object.keys(canonical.hooks)).toEqual(["sessionStart"]);
      expect((canonical as { deepagents?: unknown }).deepagents).toBeUndefined();
    });

    it("should import the legacy context.offload event as canonical contextOffload", () => {
      const hooks = new DeepagentsHooks({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: [{ command: ["bash", "-c", "echo offloaded"], events: ["context.offload"] }],
        }),
      });

      const canonical = hooks.toRulesyncHooks().getJson();

      expect(canonical.hooks.contextOffload).toEqual([
        { type: "command", command: "echo offloaded" },
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
      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
