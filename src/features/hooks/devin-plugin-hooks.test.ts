import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinHooks } from "./devin-hooks.js";
import { DevinPluginHooks } from "./devin-plugin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("DevinPluginHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("writes the bare event map to hooks.json at the plugin root", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "exec", command: "./scripts/check.sh" }] },
      }),
    });

    const hooks = await DevinPluginHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
    const projectHooks = await DevinHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

    expect(hooks).toBeInstanceOf(DevinPluginHooks);
    expect(hooks.getRelativeDirPath()).toBe(".");
    expect(hooks.getRelativeFilePath()).toBe("hooks.json");
    expect(hooks.isDeletable()).toBe(true);
    expect(JSON.parse(hooks.getFileContent())).not.toHaveProperty("hooks");
    expect(JSON.parse(hooks.getFileContent())).toEqual({
      PreToolUse: [
        {
          matcher: "exec",
          hooks: [{ type: "command", command: '"$DEVIN_PLUGIN_ROOT"/scripts/check.sh' }],
        },
      ],
    });
    // The non-plugin `devin` target keeps the command as written.
    expect(JSON.parse(projectHooks.getFileContent())).toEqual({
      PreToolUse: [
        { matcher: "exec", hooks: [{ type: "command", command: "./scripts/check.sh" }] },
      ],
    });
  });

  it("anchors later ./ script words but leaves bare commands as written", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: {
          postToolUse: [
            { matcher: "edit", command: "node ./scripts/format.js" },
            { matcher: "edit", command: "npx prettier --write ./src" },
          ],
        },
      }),
    });

    const hooks = await DevinPluginHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
    const commands = JSON.parse(hooks.getFileContent()).PostToolUse.flatMap(
      (group: { hooks: Array<{ command: string }> }) => group.hooks.map((hook) => hook.command),
    );

    expect(commands).toEqual([
      'node "$DEVIN_PLUGIN_ROOT"/scripts/format.js',
      "npx prettier --write ./src",
    ]);
  });

  it("writes the canonical failClosed as fail_closed", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "exec", command: "./guard.sh", failClosed: true }] },
      }),
    });

    const hooks = await DevinPluginHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

    expect(JSON.parse(hooks.getFileContent())).toEqual({
      PreToolUse: [
        {
          matcher: "exec",
          hooks: [{ type: "command", command: '"$DEVIN_PLUGIN_ROOT"/guard.sh', fail_closed: true }],
        },
      ],
    });
  });

  it("keeps the trigger matcher of a preCompact hook under PreCompact", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preCompact: [{ matcher: "manual", command: "./scripts/pre-compact.sh" }] },
      }),
    });

    const hooks = await DevinPluginHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

    expect(JSON.parse(hooks.getFileContent())).toEqual({
      PreCompact: [
        {
          matcher: "manual",
          hooks: [{ type: "command", command: '"$DEVIN_PLUGIN_ROOT"/scripts/pre-compact.sh' }],
        },
      ],
    });
  });

  it("imports hooks.json back into canonical hooks", async () => {
    await writeFileContent(
      join(testDir, "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          { matcher: "exec", hooks: [{ type: "command", command: "./scripts/check.sh" }] },
        ],
      }),
    );

    const hooks = await DevinPluginHooks.fromFile({ outputRoot: testDir });

    expect(hooks).toBeInstanceOf(DevinPluginHooks);
    expect(hooks.toRulesyncHooks().getJson().hooks.preToolUse).toEqual([
      expect.objectContaining({ matcher: "exec", command: "./scripts/check.sh" }),
    ]);
  });

  it("converts the plugin-root variables back to ./ on import", async () => {
    await writeFileContent(
      join(testDir, "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "exec",
            hooks: [
              { type: "command", command: '"$DEVIN_PLUGIN_ROOT"/scripts/a.sh' },
              { type: "command", command: "$DEVIN_PLUGIN_ROOT/scripts/b.sh" },
              { type: "command", command: '"$PLUGIN_ROOT"/scripts/c.sh' },
              { type: "command", command: "${PLUGIN_ROOT}/scripts/d.sh" },
              { type: "command", command: '"$CLAUDE_PLUGIN_ROOT"/scripts/e.sh' },
              { type: "command", command: 'node "$DEVIN_PLUGIN_ROOT"/scripts/f.js' },
            ],
          },
        ],
      }),
    );

    const hooks = await DevinPluginHooks.fromFile({ outputRoot: testDir });
    const commands = hooks
      .toRulesyncHooks()
      .getJson()
      .hooks.preToolUse?.map((hook) => hook.command);

    expect(commands).toEqual([
      "./scripts/a.sh",
      "./scripts/b.sh",
      "./scripts/c.sh",
      "./scripts/d.sh",
      "./scripts/e.sh",
      "node ./scripts/f.js",
    ]);
  });

  it("round-trips an anchored command through generate and import", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "exec", command: '"./scripts/my hook.sh" --fast' }] },
      }),
    });

    const generated = await DevinPluginHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
    });
    await writeFileContent(join(testDir, "hooks.json"), generated.getFileContent());
    const imported = await DevinPluginHooks.fromFile({ outputRoot: testDir });

    expect(JSON.parse(generated.getFileContent()).PreToolUse[0].hooks[0].command).toBe(
      '"$DEVIN_PLUGIN_ROOT"/"scripts/my hook.sh" --fast',
    );
    expect(imported.toRulesyncHooks().getJson().hooks.preToolUse?.[0]?.command).toBe(
      '"./scripts/my hook.sh" --fast',
    );
  });

  it("imports fail_closed from hooks.json as the canonical failClosed", async () => {
    await writeFileContent(
      join(testDir, "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "exec",
            hooks: [{ type: "command", command: "./scripts/guard.sh", fail_closed: true }],
          },
        ],
      }),
    );

    const hooks = await DevinPluginHooks.fromFile({ outputRoot: testDir });

    expect(hooks.toRulesyncHooks().getJson().hooks.preToolUse).toEqual([
      expect.objectContaining({
        matcher: "exec",
        command: "./scripts/guard.sh",
        failClosed: true,
      }),
    ]);
  });
});
