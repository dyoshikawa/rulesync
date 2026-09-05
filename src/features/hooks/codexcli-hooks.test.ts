import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliConfigToml, CodexcliHooks } from "./codexcli-hooks.js";
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

describe("CodexcliHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to Codex CLI format with PascalCase event names", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              preToolUse: [{ command: "./scripts/lint.sh", matcher: "Bash", timeout: 30 }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo start");
      expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe("command");
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("./scripts/lint.sh");
      expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(30);
    });

    it("should filter unsupported events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              preModelInvocation: [{ command: "echo before-model" }],
              subagentStop: [{ command: "echo sub" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      // Codex CLI has no equivalent of the canonical preModelInvocation event.
      expect(parsed.hooks.PreModelInvocation).toBeUndefined();
      expect(parsed.hooks.SubagentStop).toBeDefined();
    });

    it("should emit sessionEnd, commandWindows and statusMessage", async () => {
      // SessionEnd landed in Codex CLI 0.145.0; commandWindows (0.131.0) is the
      // Windows-only override for `command`, and statusMessage is the TUI label
      // shown while the hook runs. https://learn.chatgpt.com/docs/hooks
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionEnd: [
                {
                  command: "./scripts/teardown.sh",
                  commandWindows: "powershell -File ./scripts/teardown.ps1",
                  statusMessage: "Saving notes",
                },
              ],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hook = JSON.parse(codexHooks.getFileContent()).hooks.SessionEnd[0].hooks[0];
      expect(hook.command).toBe("./scripts/teardown.sh");
      expect(hook.commandWindows).toBe("powershell -File ./scripts/teardown.ps1");
      expect(hook.statusMessage).toBe("Saving notes");
    });

    it("should emit additionalContextLimit", async () => {
      // The token threshold above which Codex saves the hook's additional
      // context to a file and passes the path instead of the text (default
      // 2500). https://learn.chatgpt.com/docs/hooks
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./scripts/context.sh", additionalContextLimit: 8000 }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hook = JSON.parse(codexHooks.getFileContent()).hooks.SessionStart[0].hooks[0];
      expect(hook.additionalContextLimit).toBe(8000);
    });

    it("should emit a zero additionalContextLimit and drop a non-numeric one", async () => {
      // Zero is meaningful (always spill to a file), so unlike the string
      // passthrough's empty-string rule it must survive. A non-numeric value —
      // `null` is what JSON.stringify writes for a non-finite number — is
      // dropped rather than emitted into a file Codex would reject.
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [
                { command: "./scripts/zero.sh", additionalContextLimit: 0 },
                { command: "./scripts/bad.sh", additionalContextLimit: null },
              ],
            },
          }),
          validate: false,
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const hooks = JSON.parse(codexHooks.getFileContent()).hooks.SessionStart[0].hooks;
      expect(hooks[0].additionalContextLimit).toBe(0);
      expect(hooks[1]).not.toHaveProperty("additionalContextLimit");
    });

    it("should round-trip additionalContextLimit back to canonical", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./scripts/context.sh", additionalContextLimit: 8000 }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      expect(codexHooks.toRulesyncHooks().getJson().hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "./scripts/context.sh",
        additionalContextLimit: 8000,
      });
    });

    it("should round-trip async, which runs a command hook in the background", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./scripts/notify.sh", async: true }],
              sessionEnd: [{ command: "./scripts/teardown.sh", async: false }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].async).toBe(true);
      expect(parsed.hooks.SessionEnd[0].hooks[0].async).toBe(false);

      const json = codexHooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "./scripts/notify.sh",
        async: true,
      });
      expect(json.hooks.sessionEnd?.[0]?.async).toBe(false);
    });

    it("should convert subagentStart, subagentStop, and preCompact to PascalCase", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              subagentStart: [{ command: "echo agent-start" }],
              subagentStop: [{ command: "echo agent-stop" }],
              preCompact: [{ command: "echo compact" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SubagentStart).toBeDefined();
      expect(parsed.hooks.SubagentStart[0].hooks[0].command).toBe("echo agent-start");
      expect(parsed.hooks.SubagentStop).toBeDefined();
      expect(parsed.hooks.SubagentStop[0].hooks[0].command).toBe("echo agent-stop");
      expect(parsed.hooks.PreCompact).toBeDefined();
      expect(parsed.hooks.PreCompact[0].hooks[0].command).toBe("echo compact");
    });

    it("should convert postCompact to PostCompact with a trigger matcher", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              postCompact: [{ command: "echo post-compact", matcher: "auto" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.PostCompact).toBeDefined();
      expect(parsed.hooks.PostCompact[0].matcher).toBe("auto");
      expect(parsed.hooks.PostCompact[0].hooks[0].command).toBe("echo post-compact");
      expect(parsed.hooks.PreCompact).toBeUndefined();
    });

    it("should not prefix commands with a project dir variable", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./hooks/start.sh" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("./hooks/start.sh");
    });

    it("should process tool-specific overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo shared" }],
            },
            codexcli: {
              hooks: {
                sessionStart: [{ command: "echo override" }],
                stop: [{ command: "echo stop" }],
              },
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo override");
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe("echo stop");
    });

    it("should support permissionRequest event with matcher", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              permissionRequest: [
                { command: ".rulesync/hooks/perm.sh", matcher: "Bash", timeout: 30 },
              ],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.PermissionRequest).toBeDefined();
      expect(parsed.hooks.PermissionRequest[0].matcher).toBe("Bash");
      expect(parsed.hooks.PermissionRequest[0].hooks[0].command).toBe(".rulesync/hooks/perm.sh");
      expect(parsed.hooks.PermissionRequest[0].hooks[0].type).toBe("command");
      expect(parsed.hooks.PermissionRequest[0].hooks[0].timeout).toBe(30);
    });

    it("should preserve apply_patch and MCP tool matchers on permissionRequest", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              permissionRequest: [
                { command: "./scripts/audit-patch.sh", matcher: "apply_patch" },
                { command: "./scripts/audit-mcp.sh", matcher: "mcp__fs__read" },
              ],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.PermissionRequest).toHaveLength(2);
      const byMatcher = Object.fromEntries(
        parsed.hooks.PermissionRequest.map((entry: { matcher: string }) => [entry.matcher, entry]),
      );
      expect(byMatcher.apply_patch.hooks[0].command).toBe("./scripts/audit-patch.sh");
      expect(byMatcher.mcp__fs__read.hooks[0].command).toBe("./scripts/audit-mcp.sh");
    });

    it("should not write config.toml as a side effect", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
          }),
        }),
      );

      await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const { readFileContentOrNull } = await import("../../utils/file.js");
      const configContent = await readFileContentOrNull(join(testDir, ".codex", "config.toml"));
      expect(configContent).toBeNull();
    });

    it("should filter out non-command hook types", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [
                { type: "command", command: "echo start" },
                { type: "prompt", command: "summarize" },
              ],
              preToolUse: [{ type: "prompt", command: "review" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionStart[0].hooks).toHaveLength(1);
      expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe("command");
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo start");
      // preToolUse had only prompt hooks, so it should be excluded entirely
      expect(parsed.hooks.PreToolUse).toBeUndefined();
    });

    it("should keep an existing third-party command when preserveUnowned is set", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(
        join(testDir, ".codex", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: "echo start" },
                  { type: "command", command: "other-tool-hook codex-hook" },
                ],
              },
            ],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            preserveUnowned: true,
            hooks: { sessionStart: [{ command: "echo start" }] },
          }),
        }),
      );

      const parsed = JSON.parse(
        (
          await CodexcliHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: true,
          })
        ).getFileContent(),
      );
      const commands = parsed.hooks.SessionStart[0].hooks.map(
        (handler: { command: string }) => handler.command,
      );
      expect(commands).toEqual(["echo start", "other-tool-hook codex-hook"]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import SessionEnd along with commandWindows and statusMessage", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SessionEnd: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "./scripts/teardown.sh",
                      commandWindows: "powershell -File ./scripts/teardown.ps1",
                      statusMessage: "Saving notes",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      expect(codexHooks.toRulesyncHooks().getJson().hooks.sessionEnd?.[0]).toEqual({
        type: "command",
        command: "./scripts/teardown.sh",
        commandWindows: "powershell -File ./scripts/teardown.ps1",
        statusMessage: "Saving notes",
      });
    });

    it("should import additionalContextLimit and ignore a non-numeric one", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "./scripts/context.sh",
                      additionalContextLimit: 8000,
                    },
                    {
                      type: "command",
                      command: "./scripts/other.sh",
                      additionalContextLimit: "8000",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const imported = codexHooks.toRulesyncHooks().getJson().hooks.sessionStart;
      expect(imported?.[0]).toEqual({
        type: "command",
        command: "./scripts/context.sh",
        additionalContextLimit: 8000,
      });
      expect(imported?.[1]).toEqual({ type: "command", command: "./scripts/other.sh" });
    });

    it("should convert Codex CLI format to canonical format", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: [
                {
                  matcher: "init",
                  hooks: [
                    {
                      type: "command",
                      command: "echo start",
                      timeout: 1000,
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "echo start",
        timeout: 1000,
        matcher: "init",
      });
    });

    it("should handle missing optional fields", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              Stop: [
                {
                  hooks: [{ command: "echo done" }],
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.stop).toBeDefined();
      expect(parsed.hooks.stop?.[0]).toEqual({
        type: "command",
        command: "echo done",
      });
    });

    it("should convert PermissionRequest to canonical permissionRequest", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              PermissionRequest: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".rulesync/hooks/perm.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.permissionRequest).toBeDefined();
      expect(parsed.hooks.permissionRequest?.[0]).toEqual({
        type: "command",
        command: ".rulesync/hooks/perm.sh",
        matcher: "Bash",
      });
    });

    it("should convert SubagentStart, SubagentStop, and PreCompact to canonical names", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SubagentStart: [{ hooks: [{ command: "echo agent-start" }] }],
              SubagentStop: [{ hooks: [{ command: "echo agent-stop" }] }],
              PreCompact: [{ hooks: [{ command: "echo compact" }] }],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.subagentStart?.[0]?.command).toBe("echo agent-start");
      expect(parsed.hooks.subagentStop?.[0]?.command).toBe("echo agent-stop");
      expect(parsed.hooks.preCompact?.[0]?.command).toBe("echo compact");
    });

    it("should convert PostCompact to canonical postCompact preserving the trigger matcher", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              PostCompact: [{ matcher: "manual", hooks: [{ command: "echo post-compact" }] }],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.postCompact?.[0]).toEqual({
        type: "command",
        command: "echo post-compact",
        matcher: "manual",
      });
    });

    it("should ignore invalid entries", () => {
      const codexHooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: "invalid",
              Stop: ["invalid", { hooks: "invalid" }],
            },
          }),
        }),
      );

      const rulesyncHooks = codexHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeUndefined();
      expect(parsed.hooks.stop).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from .codex/hooks.json when it exists", async () => {
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(
        join(testDir, ".codex", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
          },
        }),
      );

      const codexHooks = await CodexcliHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(codexHooks).toBeInstanceOf(CodexcliHooks);
      const content = codexHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when hooks.json does not exist", async () => {
      const codexHooks = await CodexcliHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(codexHooks).toBeInstanceOf(CodexcliHooks);
      const content = codexHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return true", () => {
      const hooks = new CodexcliHooks(
        createMockAiFileParams({
          relativeDirPath: ".codex",
          relativeFilePath: "hooks.json",
        }),
      );
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create instance with empty hooks", () => {
      const hooks = CodexcliHooks.forDeletion({
        relativeDirPath: ".codex",
        relativeFilePath: "hooks.json",
      });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});

describe("CodexcliConfigToml", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should not force-write [features] hooks = true (hooks are GA/default-on)", async () => {
    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    expect(configToml.getFileContent()).not.toContain("hooks = true");
    expect(configToml.getFileContent()).not.toContain("codex_hooks");
  });

  it("should preserve existing config.toml content", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      '[mcp_servers.myserver]\ncommand = "node"\n',
    );

    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    const content = configToml.getFileContent();
    expect(content).not.toContain("hooks = true");
    expect(content).not.toContain("codex_hooks");
    expect(content).toContain("mcp_servers");
    expect(content).toContain("myserver");
  });

  it("should preserve existing [features] values without adding hooks = true", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(join(testDir, ".codex", "config.toml"), "[features]\nverbose = true\n");

    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    const content = configToml.getFileContent();
    expect(content).not.toContain("hooks = true");
    expect(content).toContain("verbose = true");
  });

  it("should not strip a user-set [features] hooks = true value", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      "[features]\nhooks = true\nverbose = true\n",
    );

    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    const content = configToml.getFileContent();
    expect(content).toContain("hooks = true");
    expect(content).toContain("verbose = true");
  });

  it("should remove deprecated codex_hooks without adding hooks = true", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      "[features]\ncodex_hooks = true\nverbose = true\n",
    );

    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    const content = configToml.getFileContent();
    expect(content).not.toContain("hooks = true");
    expect(content).toContain("verbose = true");
    expect(content).not.toContain("codex_hooks");
  });

  it("should throw a readable error when existing config.toml is invalid", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(join(testDir, ".codex", "config.toml"), "[features");

    await expect(CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir })).rejects.toThrow(
      "Failed to parse existing Codex CLI config",
    );
  });

  it("should set correct file paths", async () => {
    const configToml = await CodexcliConfigToml.fromOutputRoot({ outputRoot: testDir });
    expect(configToml.getRelativeDirPath()).toBe(".codex");
    expect(configToml.getRelativeFilePath()).toBe("config.toml");
  });
});
