import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { GeminicliHooks } from "./geminicli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("GeminicliHooks", () => {
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

  it("uses Gemini settings.json in project and global mode", () => {
    expect(GeminicliHooks.getSettablePaths()).toEqual({
      relativeDirPath: ".gemini",
      relativeFilePath: "settings.json",
    });
    expect(GeminicliHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".gemini",
      relativeFilePath: "settings.json",
    });
  });

  it("maps canonical events to Gemini CLI native event names", async () => {
    const source = makeRulesyncHooks({
      version: 1,
      hooks: {
        sessionStart: [{ command: "echo start", matcher: "startup" }],
        beforeSubmitPrompt: [{ command: "echo before-agent" }],
        stop: [{ command: "echo after-agent" }],
        preModelInvocation: [{ command: "echo before-model" }],
        postModelInvocation: [{ command: "echo after-model" }],
        beforeToolSelection: [{ command: "echo select" }],
        preToolUse: [{ command: "echo before-tool", matcher: "write_file" }],
        postToolUse: [{ command: "echo after-tool", timeout: 5 }],
        preCompact: [{ command: "echo compress" }],
        notification: [{ command: "echo notify" }],
        sessionEnd: [{ command: "echo end" }],
      },
    });

    const generated = await GeminicliHooks.fromRulesyncHooks({
      rulesyncHooks: source,
      outputRoot: testDir,
    });
    const parsed = JSON.parse(generated.getFileContent());

    expect(Object.keys(parsed.hooks)).toEqual([
      "SessionStart",
      "BeforeAgent",
      "AfterAgent",
      "BeforeModel",
      "AfterModel",
      "BeforeToolSelection",
      "BeforeTool",
      "AfterTool",
      "PreCompress",
      "Notification",
      "SessionEnd",
    ]);
    expect(parsed.hooks.BeforeTool).toEqual([
      { matcher: "write_file", hooks: [{ type: "command", command: "echo before-tool" }] },
    ]);
    expect(parsed.hooks.AfterTool[0].hooks[0]).toEqual({
      type: "command",
      command: "echo after-tool",
      timeout: 5,
    });
  });

  it("preserves unrelated settings while replacing only hooks in project and global mode", async () => {
    for (const global of [false, true]) {
      const root = global ? join(testDir, "home") : join(testDir, "project");
      const settingsPath = join(root, ".gemini", "settings.json");
      await writeFileContent(
        settingsPath,
        JSON.stringify({ theme: "Dracula", security: { auth: "oauth" }, hooks: { Old: [] } }),
      );
      const generated = await GeminicliHooks.fromRulesyncHooks({
        rulesyncHooks: makeRulesyncHooks({ hooks: { preToolUse: [{ command: "echo safe" }] } }),
        outputRoot: root,
        global,
      });
      await writeFileContent(settingsPath, generated.getFileContent());
      expect(JSON.parse(await readFileContent(settingsPath))).toEqual({
        theme: "Dracula",
        security: { auth: "oauth" },
        hooks: { BeforeTool: [{ hooks: [{ type: "command", command: "echo safe" }] }] },
      });
    }
  });

  it("imports and regenerates Gemini native hooks without losing native fields", async () => {
    const native = {
      hooks: {
        BeforeTool: [
          {
            matcher: "shell",
            sequential: true,
            hooks: [
              {
                type: "command",
                command: "./check.sh",
                name: "check",
                description: "Checks input",
                timeout: 30,
              },
            ],
          },
        ],
        BeforeAgent: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
      },
    };
    const settingsPath = join(testDir, ".gemini", "settings.json");
    await writeFileContent(settingsPath, JSON.stringify({ theme: "Default", ...native }));

    const imported = await GeminicliHooks.fromFile({ outputRoot: testDir });
    expect(JSON.parse(imported.toRulesyncHooks().getFileContent())).toEqual({
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: "command",
            command: "./check.sh",
            matcher: "shell",
            timeout: 30,
            name: "check",
            description: "Checks input",
            sequential: true,
          },
        ],
        beforeSubmitPrompt: [{ type: "command", command: "echo prompt" }],
      },
    });

    const regenerated = await GeminicliHooks.fromRulesyncHooks({
      rulesyncHooks: imported.toRulesyncHooks(),
      outputRoot: testDir,
    });
    const regeneratedHooks = JSON.parse(regenerated.getFileContent()).hooks;
    expect(regeneratedHooks).toEqual({
      ...native.hooks,
      BeforeTool: [
        {
          ...native.hooks.BeforeTool[0],
          hooks: [
            {
              type: "command",
              command: '"$GEMINI_PROJECT_DIR"/check.sh',
              name: "check",
              description: "Checks input",
              timeout: 30,
            },
          ],
        },
      ],
    });
  });

  it("rejects invalid settings JSON instead of overwriting it", async () => {
    const settingsPath = join(testDir, ".gemini", "settings.json");
    await writeFileContent(settingsPath, "{ invalid");
    await expect(
      GeminicliHooks.fromRulesyncHooks({
        rulesyncHooks: makeRulesyncHooks({ hooks: { preToolUse: [{ command: "echo no" }] } }),
        outputRoot: testDir,
      }),
    ).rejects.toThrow();
    expect(await readFileContent(settingsPath)).toBe("{ invalid");
  });
});
