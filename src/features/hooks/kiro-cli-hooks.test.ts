import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroCliHooks } from "./kiro-cli-hooks.js";
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

  it("honors the kiro-cli override key and ignores the kiro-ide override", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: { sessionStart: [{ command: "echo shared" }] },
        // The IDE override must NOT leak into kiro-cli output.
        "kiro-ide": { hooks: { stop: [{ command: "echo kiro-ide" }] } },
        "kiro-cli": { hooks: { stop: [{ command: "echo kiro-cli" }] } },
      }),
    });

    const hooks = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
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
    expect(triggers.Stop).toBe("echo kiro-cli");
  });

  it("routes imported hooks into the kiro-cli override block", async () => {
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
    expect(imported["kiro-cli"].hooks.PostFileSave[0].command).toBe("echo saved");
    expect(imported["kiro-ide"]).toBeUndefined();
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
