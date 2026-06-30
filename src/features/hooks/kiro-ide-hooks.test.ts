import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { KiroIdeHooks } from "./kiro-ide-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("KiroIdeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("emits a v1 envelope with one entry per canonical definition", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {
          sessionStart: [{ command: ".rulesync/hooks/session-start.sh" }],
          preToolUse: [
            { command: ".rulesync/hooks/audit.sh", matcher: "Bash", timeout: 30, name: "audit" },
          ],
          stop: [{ type: "prompt", prompt: "Summarize the changes" }],
        },
      }),
    });

    const hooks = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
    });

    const parsed = JSON.parse(hooks.getFileContent());
    expect(parsed.version).toBe("v1");
    expect(Array.isArray(parsed.hooks)).toBe(true);

    type KiroIdeEntry = {
      trigger: string;
      name?: string;
      matcher?: string;
      timeout?: number;
      enabled?: boolean;
      action?: { type: string; command?: string; prompt?: string };
    };
    const entries = parsed.hooks as KiroIdeEntry[];
    const byTrigger = (trigger: string): KiroIdeEntry => {
      const found = entries.find((h) => h.trigger === trigger);
      expect(found).toBeDefined();
      return found as KiroIdeEntry;
    };

    // Canonical → PascalCase trigger mapping.
    expect(byTrigger("SessionStart").action).toEqual({
      type: "command",
      command: ".rulesync/hooks/session-start.sh",
    });
    expect(byTrigger("SessionStart").enabled).toBe(true);

    // matcher + timeout (seconds) + explicit name preserved.
    expect(byTrigger("PreToolUse").matcher).toBe("Bash");
    expect(byTrigger("PreToolUse").timeout).toBe(30);
    expect(byTrigger("PreToolUse").name).toBe("audit");

    // `prompt`-type definition becomes an `agent` action.
    expect(byTrigger("Stop").action).toEqual({ type: "agent", prompt: "Summarize the changes" });
  });

  it("passes IDE-only triggers through a kiro-ide override block verbatim", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {},
        "kiro-ide": {
          hooks: {
            PostFileSave: [{ type: "prompt", prompt: "Run the formatter" }],
          },
        },
      }),
    });

    const hooks = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
    });

    const parsed = JSON.parse(hooks.getFileContent());
    expect(parsed.hooks[0].trigger).toBe("PostFileSave");
    expect(parsed.hooks[0].action).toEqual({ type: "agent", prompt: "Run the formatter" });
  });

  it("writes to .kiro/hooks/rulesync.json", () => {
    const paths = KiroIdeHooks.getSettablePaths();
    expect(join(paths.relativeDirPath, paths.relativeFilePath)).toBe(
      join(".kiro", "hooks", "rulesync.json"),
    );
    // The same relative path is used in global mode (rooted at the home dir).
    expect(KiroIdeHooks.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".kiro", "hooks"),
    );
  });

  it("round-trips Kiro IDE hooks back to canonical events", async () => {
    const hooks = new KiroIdeHooks({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "hooks"),
      relativeFilePath: "rulesync.json",
      fileContent: JSON.stringify({
        version: "v1",
        hooks: [
          {
            name: "lint-on-save",
            trigger: "PreToolUse",
            matcher: "Bash",
            action: { type: "command", command: "echo lint" },
            timeout: 30,
            enabled: true,
          },
          {
            name: "agent-summary",
            trigger: "Stop",
            action: { type: "agent", prompt: "Summarize" },
          },
        ],
      }),
    });

    const rulesyncHooks = hooks.toRulesyncHooks();
    const canonical = JSON.parse(rulesyncHooks.getFileContent());
    expect(canonical.hooks.preToolUse[0].command).toBe("echo lint");
    expect(canonical.hooks.preToolUse[0].matcher).toBe("Bash");
    expect(canonical.hooks.preToolUse[0].timeout).toBe(30);
    expect(canonical.hooks.stop[0].type).toBe("prompt");
    expect(canonical.hooks.stop[0].prompt).toBe("Summarize");
  });
});
