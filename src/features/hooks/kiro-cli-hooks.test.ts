import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroCliHooks } from "./kiro-cli-hooks.js";
import { KiroIdeHooks } from "./kiro-ide-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("KiroCliHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("writes the standalone v1 hooks file Kiro CLI 3.0 reads (#2408)", () => {
    // The embedded `.kiro/agents/default.json` format this target used to emit
    // is documented as not working in 3.0.
    expect(KiroCliHooks.getSettablePaths()).toEqual({
      relativeDirPath: join(".kiro", "hooks"),
      relativeFilePath: "rulesync.json",
    });
  });

  it("reads the shared kiro override block and warns about per-target blocks", async () => {
    const logger = createMockLogger();
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: { sessionStart: [{ command: "echo shared" }] },
        kiro: { hooks: { stop: [{ command: "echo kiro" }] } },
        // Per-target blocks are read by nothing: both Kiro targets write the
        // same file, so they share the `kiro` block.
        "kiro-cli": { hooks: { stop: [{ command: "echo kiro-cli" }] } },
      }),
    });

    const hooks = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
      logger,
    });

    expect(hooks).toBeInstanceOf(KiroCliHooks);
    const parsed = JSON.parse(hooks.getFileContent());
    expect(parsed.version).toBe("v1");
    const triggers = Object.fromEntries(
      parsed.hooks.map((entry: { trigger: string; action: { command?: string } }) => [
        entry.trigger,
        entry.action.command,
      ]),
    );
    expect(triggers.SessionStart).toBe("echo shared");
    expect(triggers.Stop).toBe("echo kiro");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro-cli.hooks" block'));
  });

  it("generates the identical file for kiro-cli and kiro-ide", async () => {
    const fileContent = JSON.stringify({
      hooks: { sessionStart: [{ command: "echo shared" }] },
      kiro: { hooks: { PostFileSave: [{ command: "echo saved" }] } },
    });
    const makeRulesyncHooks = () =>
      new RulesyncHooks({
        outputRoot: "/mock",
        relativeDirPath: ".rulesync",
        relativeFilePath: "hooks.json",
        fileContent,
      });

    const cli = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: makeRulesyncHooks(),
      validate: true,
    });
    const ide = await KiroIdeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: makeRulesyncHooks(),
      validate: true,
    });

    // Both targets write the same `.kiro/hooks/rulesync.json`, so whichever
    // runs last must not change the result.
    expect(cli.getRelativeDirPath()).toBe(ide.getRelativeDirPath());
    expect(cli.getRelativeFilePath()).toBe(ide.getRelativeFilePath());
    expect(cli.getFileContent()).toBe(ide.getFileContent());
    expect(cli.getFileContent()).toContain("echo saved");
  });

  it("routes imported hooks into the shared kiro override block", async () => {
    const hooksDir = join(testDir, ".kiro", "hooks");
    await ensureDir(hooksDir);
    await writeFileContent(
      join(hooksDir, "rulesync.json"),
      JSON.stringify({
        version: "v1",
        hooks: [
          {
            name: "on-save",
            // A trigger with no canonical event, so it can only survive in the
            // tool-specific override block.
            trigger: "PostFileSave",
            action: { type: "command", command: "echo saved" },
          },
        ],
      }),
    );

    const hooks = await KiroCliHooks.fromFile({ outputRoot: testDir });
    expect(hooks).toBeInstanceOf(KiroCliHooks);

    const imported = JSON.parse(hooks.toRulesyncHooks().getFileContent());
    expect(imported.kiro.hooks.PostFileSave[0].command).toBe("echo saved");
    expect(imported["kiro-cli"]).toBeUndefined();
    expect(imported["kiro-ide"]).toBeUndefined();
  });

  it("writes a prompt hook as an agent action", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {
          stop: [{ type: "prompt", prompt: "Summarize the session" }],
          // Kiro's standalone triggers have no SessionEnd, so this is filtered
          // out rather than folded into Stop the way the legacy format did.
          sessionEnd: [{ command: "echo bye" }],
        },
      }),
    });

    const hooks = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
    });

    const entries = JSON.parse(hooks.getFileContent()).hooks as Array<{
      trigger: string;
      action: { type: string; prompt?: string };
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.trigger).toBe("Stop");
    expect(entries[0]?.action).toEqual({ type: "agent", prompt: "Summarize the session" });
  });

  it("keeps its own class identity through forDeletion", () => {
    const deleted = KiroCliHooks.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".kiro", "hooks"),
      relativeFilePath: "rulesync.json",
    });
    expect(deleted).toBeInstanceOf(KiroCliHooks);
    expect(JSON.parse(deleted.getFileContent()).hooks).toEqual([]);
  });

  it("reads and writes the user-scope hooks file in global mode", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({ hooks: { stop: [{ command: "echo global" }] } }),
    });

    const hooks = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      global: true,
      validate: true,
    });

    // Kiro CLI 2.13.0 added the user-scope `~/.kiro/hooks/` location; the
    // relative path is the same and the scope is resolved by `outputRoot`.
    expect(hooks.getRelativeDirPath()).toBe(join(".kiro", "hooks"));
    expect(JSON.parse(hooks.getFileContent()).hooks[0].action.command).toBe("echo global");
  });
});
