import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readOrInitializeFileContent, ensureDir, writeFileContent } from "../../utils/file.js";
import { QwencodeHooks } from "./qwencode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function createMockAiFileParams(
  override: Partial<ConstructorParameters<typeof RulesyncHooks>[0]> = {},
) {
  return {
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: "{}",
    ...override,
  };
}

describe("QwencodeHooks", () => {
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

  describe("fromRulesyncHooks", () => {
    it("should map canonical events to Qwen Code PascalCase and filter unsupported events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                { command: "echo pre", name: "Pre Hook", description: "Runs before tool" },
              ],
              beforeSubmitPrompt: [{ command: "echo prompt" }],
              postToolUseFailure: [{ command: "echo failure" }],
              // Not in QWENCODE_HOOK_EVENTS -> should be dropped.
              afterFileEdit: [{ command: "echo ignored" }],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("echo pre");
      expect(parsed.hooks.PreToolUse[0].hooks[0].name).toBe("Pre Hook");
      expect(parsed.hooks.PreToolUse[0].hooks[0].description).toBe("Runs before tool");
      expect(parsed.hooks.UserPromptSubmit).toBeDefined();
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe("echo prompt");
      expect(parsed.hooks.PostToolUseFailure).toBeDefined();
      expect(parsed.hooks.PostToolUseFailure[0].hooks[0].command).toBe("echo failure");
      // Unsupported canonical event must not leak through.
      expect(parsed.hooks.AfterFileEdit).toBeUndefined();
    });

    it("should NOT prefix dot-relative commands with $GEMINI_PROJECT_DIR", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./hooks/start.sh" }],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("./hooks/start.sh");
      expect(parsed.hooks.SessionStart[0].hooks[0].command).not.toContain("GEMINI_PROJECT_DIR");
    });

    it("should group definitions by matcher", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                { command: "echo a", matcher: "Edit" },
                { command: "echo b", matcher: "Edit" },
                { command: "echo c", matcher: "Write" },
              ],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      const groups = parsed.hooks.PreToolUse;
      expect(groups).toHaveLength(2);
      const editGroup = groups.find((g: { matcher?: string }) => g.matcher === "Edit");
      const writeGroup = groups.find((g: { matcher?: string }) => g.matcher === "Write");
      expect(editGroup.hooks).toHaveLength(2);
      expect(editGroup.hooks[0].command).toBe("echo a");
      expect(editGroup.hooks[1].command).toBe("echo b");
      expect(writeGroup.hooks).toHaveLength(1);
      expect(writeGroup.hooks[0].command).toBe("echo c");
    });

    it("should merge with existing settings.json", async () => {
      const mockSettings = {
        theme: "dark",
        hooks: {
          OldEvent: [{ hooks: [{ command: "old" }] }],
        },
      };

      const settingsPath = join(testDir, ".qwen", "settings.json");
      await ensureDir(join(testDir, ".qwen"));
      await readOrInitializeFileContent(settingsPath, JSON.stringify(mockSettings));

      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.theme).toBe("dark");
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.OldEvent).toBeUndefined();
    });

    it("should process qwencode overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
            qwencode: {
              hooks: {
                sessionStart: [{ command: "echo override" }],
                sessionEnd: [{ command: "echo end" }],
              },
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo override");
      expect(parsed.hooks.SessionEnd[0].hooks[0].command).toBe("echo end");
    });

    it("should map the new TodoCreated, TodoCompleted, and StopFailure events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              todoCreated: [{ command: "echo created" }],
              todoCompleted: [{ command: "echo completed" }],
              stopFailure: [{ command: "echo stop-failure" }],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks.TodoCreated[0].hooks[0].command).toBe("echo created");
      expect(parsed.hooks.TodoCompleted[0].hooks[0].command).toBe("echo completed");
      expect(parsed.hooks.StopFailure[0].hooks[0].command).toBe("echo stop-failure");
    });

    it("should preserve the http hook type and its url", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ type: "http", url: "https://example.com/hook", matcher: "Edit" }],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse[0].hooks[0].type).toBe("http");
      expect(parsed.hooks.PreToolUse[0].hooks[0].url).toBe("https://example.com/hook");
    });

    it("should emit command-only per-hook fields (async/env/shell/statusMessage)", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                {
                  type: "command",
                  command: "echo cmd",
                  matcher: "Edit",
                  async: true,
                  env: { FOO: "bar" },
                  shell: "bash",
                  statusMessage: "Running...",
                },
              ],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hook = JSON.parse(qwencodeHooks.getFileContent()).hooks.PreToolUse[0].hooks[0];
      expect(hook.async).toBe(true);
      expect(hook.env).toEqual({ FOO: "bar" });
      expect(hook.shell).toBe("bash");
      expect(hook.statusMessage).toBe("Running...");
      // Http-only fields must never leak onto command hooks.
      expect(hook.headers).toBeUndefined();
      expect(hook.allowedEnvVars).toBeUndefined();
      expect(hook.once).toBeUndefined();
    });

    it("should emit http-only per-hook fields (headers/allowedEnvVars/once/statusMessage)", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                {
                  type: "http",
                  url: "https://example.com/hook",
                  matcher: "Edit",
                  headers: { Authorization: "Bearer ${HOOK_API_KEY}" },
                  allowedEnvVars: ["HOOK_API_KEY"],
                  once: true,
                  statusMessage: "Calling remote...",
                },
              ],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hook = JSON.parse(qwencodeHooks.getFileContent()).hooks.PreToolUse[0].hooks[0];
      expect(hook.headers).toEqual({ Authorization: "Bearer ${HOOK_API_KEY}" });
      expect(hook.allowedEnvVars).toEqual(["HOOK_API_KEY"]);
      expect(hook.once).toBe(true);
      expect(hook.statusMessage).toBe("Calling remote...");
      // Command-only fields must never leak onto http hooks.
      expect(hook.async).toBeUndefined();
      expect(hook.env).toBeUndefined();
      expect(hook.shell).toBeUndefined();
    });

    it("should not emit command-only fields onto http hooks or http-only fields onto command hooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                // Command hook authored with http-only fields -> dropped on emit.
                { type: "command", command: "echo cmd", matcher: "Edit", once: true },
                // Http hook authored with command-only fields -> dropped on emit.
                {
                  type: "http",
                  url: "https://example.com/hook",
                  matcher: "Edit",
                  async: true,
                },
              ],
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hooks = JSON.parse(qwencodeHooks.getFileContent()).hooks.PreToolUse[0].hooks;
      const commandHook = hooks.find((h: { type: string }) => h.type === "command");
      const httpHook = hooks.find((h: { type: string }) => h.type === "http");
      expect(commandHook.once).toBeUndefined();
      expect(httpHook.async).toBeUndefined();
    });

    it("should emit group-level sequential and top-level disableAllHooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo a", matcher: "Edit", sequential: true }],
            },
            qwencode: {
              disableAllHooks: true,
            },
          }),
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.disableAllHooks).toBe(true);
      expect(parsed.hooks.PreToolUse[0].sequential).toBe(true);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should round-trip Qwen Code PascalCase back to canonical", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "echo pre",
                      timeout: 1000,
                      name: "Pre Hook",
                      description: "Runs before tool",
                    },
                  ],
                },
              ],
              UserPromptSubmit: [{ hooks: [{ command: "echo prompt" }] }],
              PostToolUseFailure: [{ hooks: [{ command: "echo failure" }] }],
            },
          }),
        }),
      );

      const rulesyncHooks = qwencodeHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "command",
        command: "echo pre",
        timeout: 1000,
        matcher: "Edit",
        name: "Pre Hook",
        description: "Runs before tool",
      });
      expect(parsed.hooks.beforeSubmitPrompt?.[0]).toEqual({
        type: "command",
        command: "echo prompt",
      });
      expect(parsed.hooks.postToolUseFailure?.[0]).toEqual({
        type: "command",
        command: "echo failure",
      });
    });

    it("should NOT strip a $GEMINI_PROJECT_DIR prefix on import", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: [{ hooks: [{ command: "$GEMINI_PROJECT_DIR/echo start" }] }],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.sessionStart?.[0]?.command).toBe("$GEMINI_PROJECT_DIR/echo start");
    });

    it("should import the new TodoCreated, TodoCompleted, and StopFailure events", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              TodoCreated: [{ hooks: [{ command: "echo created" }] }],
              TodoCompleted: [{ hooks: [{ command: "echo completed" }] }],
              StopFailure: [{ hooks: [{ command: "echo stop-failure" }] }],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.todoCreated?.[0]?.command).toBe("echo created");
      expect(parsed.hooks.todoCompleted?.[0]?.command).toBe("echo completed");
      expect(parsed.hooks.stopFailure?.[0]?.command).toBe("echo stop-failure");
    });

    it("should preserve the http hook type and its url on import", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [{ type: "http", url: "https://example.com/hook" }],
                },
              ],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "http",
        url: "https://example.com/hook",
        matcher: "Edit",
      });
    });

    it("should import command-only per-hook fields (async/env/shell/statusMessage)", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "echo cmd",
                      async: true,
                      env: { FOO: "bar" },
                      shell: "bash",
                      statusMessage: "Running...",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "command",
        command: "echo cmd",
        statusMessage: "Running...",
        async: true,
        env: { FOO: "bar" },
        shell: "bash",
        matcher: "Edit",
      });
    });

    it("should import http-only per-hook fields (headers/allowedEnvVars/once/statusMessage)", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "http",
                      url: "https://example.com/hook",
                      headers: { Authorization: "Bearer ${HOOK_API_KEY}" },
                      allowedEnvVars: ["HOOK_API_KEY"],
                      once: true,
                      statusMessage: "Calling remote...",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "http",
        url: "https://example.com/hook",
        statusMessage: "Calling remote...",
        headers: { Authorization: "Bearer ${HOOK_API_KEY}" },
        allowedEnvVars: ["HOOK_API_KEY"],
        once: true,
        matcher: "Edit",
      });
    });

    it("should not import command-only fields onto http hooks or http-only fields onto command hooks", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    // http hook carrying a command-only field upstream rejects.
                    { type: "http", url: "https://example.com/hook", async: true },
                    // command hook carrying an http-only field upstream rejects.
                    { type: "command", command: "echo cmd", once: true },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      const httpDef = parsed.hooks.preToolUse?.find((d) => d.type === "http");
      const commandDef = parsed.hooks.preToolUse?.find((d) => d.type === "command");
      expect(httpDef?.async).toBeUndefined();
      expect(commandDef?.once).toBeUndefined();
    });

    it("should round-trip group-level sequential and top-level disableAllHooks", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            disableAllHooks: true,
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  sequential: true,
                  hooks: [{ type: "command", command: "echo a" }],
                },
              ],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.qwencode?.disableAllHooks).toBe(true);
      expect(parsed.hooks.preToolUse?.[0]?.sequential).toBe(true);
    });

    it("should ignore invalid entries", () => {
      const qwencodeHooks = new QwencodeHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: "invalid",
              SessionEnd: ["invalid", { hooks: "invalid" }],
            },
          }),
        }),
      );

      const parsed = qwencodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse).toBeUndefined();
      expect(parsed.hooks.sessionEnd).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from .qwen/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "settings.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
          },
        }),
      );

      const qwencodeHooks = await QwencodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(qwencodeHooks).toBeInstanceOf(QwencodeHooks);
      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when settings.json does not exist", async () => {
      const qwencodeHooks = await QwencodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(qwencodeHooks).toBeInstanceOf(QwencodeHooks);
      const parsed = JSON.parse(qwencodeHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new QwencodeHooks(createMockAiFileParams());
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create instance with empty hooks", () => {
      const hooks = QwencodeHooks.forDeletion({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
      });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
