import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { HooksConfigSchema } from "../../types/hooks.js";
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

  it("passes IDE-only triggers through the shared kiro override block verbatim", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {},
        kiro: {
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

  it("ignores a per-target override block and warns about it", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: { sessionStart: [{ command: "echo shared" }] },
        // Both Kiro targets write the same file and read one shared `kiro`
        // block, so a per-target block is read by neither.
        "kiro-cli": { hooks: { stop: [{ command: "echo kiro-cli" }] } },
      }),
    });

    const logger = createMockLogger();
    const hooks = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      logger,
    });

    expect(hooks).toBeInstanceOf(KiroIdeHooks);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro-cli.hooks" block'));
    const triggers = (JSON.parse(hooks.getFileContent()).hooks as Array<{ trigger: string }>).map(
      (entry) => entry.trigger,
    );
    expect(triggers).toEqual(["SessionStart"]);
  });

  it("warns about every per-target override block that is authored", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: { sessionStart: [{ command: "echo shared" }] },
        "kiro-ide": { hooks: { stop: [{ command: "echo kiro-ide" }] } },
        "kiro-cli": { hooks: { stop: [{ command: "echo kiro-cli" }] } },
      }),
    });

    const logger = createMockLogger();
    const hooks = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      logger,
    });

    // Neither block is read, so nothing but the shared event is emitted...
    const triggers = (JSON.parse(hooks.getFileContent()).hooks as Array<{ trigger: string }>).map(
      (entry) => entry.trigger,
    );
    expect(triggers).toEqual(["SessionStart"]);
    // ...and both are reported by name.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro-ide.hooks" block'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro-cli.hooks" block'));
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

  it("round-trips a disabled hook instead of silently reactivating it", async () => {
    const hooks = new KiroIdeHooks({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "hooks"),
      relativeFilePath: "rulesync.json",
      fileContent: JSON.stringify({
        version: "v1",
        hooks: [
          {
            name: "paused-lint",
            trigger: "PreToolUse",
            action: { type: "command", command: "echo lint" },
            enabled: false,
          },
          {
            name: "active-lint",
            trigger: "Stop",
            action: { type: "command", command: "echo done" },
            enabled: true,
          },
        ],
      }),
    });

    const rulesyncHooks = hooks.toRulesyncHooks();
    const canonical = JSON.parse(rulesyncHooks.getFileContent());
    expect(canonical.hooks.preToolUse[0].enabled).toBe(false);
    // `true` is Kiro's default, so it is not written back into the canonical file.
    expect(canonical.hooks.stop[0].enabled).toBeUndefined();
    expect(HooksConfigSchema.safeParse(canonical).success).toBe(true);

    const regenerated = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
    });
    const entries = JSON.parse(regenerated.getFileContent()).hooks as {
      name: string;
      enabled: boolean;
    }[];
    expect(entries.find((entry) => entry.name === "paused-lint")?.enabled).toBe(false);
    expect(entries.find((entry) => entry.name === "active-lint")?.enabled).toBe(true);
  });

  it("routes IDE-only triggers into the shared kiro override block on import", async () => {
    const hooks = new KiroIdeHooks({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "hooks"),
      relativeFilePath: "rulesync.json",
      fileContent: JSON.stringify({
        version: "v1",
        hooks: [
          {
            name: "format-on-save",
            trigger: "PostFileSave",
            action: { type: "command", command: "pnpm fmt" },
            enabled: true,
          },
          {
            name: "lint",
            trigger: "PreToolUse",
            action: { type: "command", command: "echo lint" },
            enabled: true,
          },
        ],
      }),
    });

    const rulesyncHooks = hooks.toRulesyncHooks();
    const canonical = JSON.parse(rulesyncHooks.getFileContent());
    // The IDE-only trigger must not land in the top-level hooks record (whose
    // keys are restricted to canonical event names) but under the shared `kiro`
    // override block, which passes tool-native keys through verbatim.
    expect(canonical.hooks.PostFileSave).toBeUndefined();
    expect(canonical.hooks.preToolUse[0].command).toBe("echo lint");
    expect(canonical.kiro.hooks.PostFileSave[0].command).toBe("pnpm fmt");
    expect(canonical["kiro-ide"]).toBeUndefined();
    // The imported content must survive canonical re-validation, so the next
    // generate run does not fail on it.
    expect(HooksConfigSchema.safeParse(canonical).success).toBe(true);
  });
});
