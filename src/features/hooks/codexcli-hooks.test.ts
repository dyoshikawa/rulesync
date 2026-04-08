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
    baseDir: "/mock",
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
        baseDir: testDir,
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
              sessionEnd: [{ command: "echo end" }],
              subagentStop: [{ command: "echo sub" }],
            },
          }),
        }),
      );

      const codexHooks = await CodexcliHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionEnd).toBeUndefined();
      expect(parsed.hooks.SubagentStop).toBeUndefined();
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
        baseDir: testDir,
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
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(codexHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo override");
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe("echo stop");
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
        baseDir: testDir,
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
        baseDir: testDir,
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
  });

  describe("toRulesyncHooks", () => {
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
        baseDir: testDir,
        validate: false,
      });
      expect(codexHooks).toBeInstanceOf(CodexcliHooks);
      const content = codexHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when hooks.json does not exist", async () => {
      const codexHooks = await CodexcliHooks.fromFile({
        baseDir: testDir,
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

  it("should generate config.toml with codex_hooks feature flag", async () => {
    const configToml = await CodexcliConfigToml.fromBaseDir({ baseDir: testDir });
    expect(configToml.getFileContent()).toContain("codex_hooks");
  });

  it("should preserve existing config.toml content", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      '[mcp_servers.myserver]\ncommand = "node"\n',
    );

    const configToml = await CodexcliConfigToml.fromBaseDir({ baseDir: testDir });
    const content = configToml.getFileContent();
    expect(content).toContain("codex_hooks");
    expect(content).toContain("mcp_servers");
    expect(content).toContain("myserver");
  });

  it("should merge with existing [features] section without overwriting other flags", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      "[features]\nsome_other_flag = true\n",
    );

    const configToml = await CodexcliConfigToml.fromBaseDir({ baseDir: testDir });
    const content = configToml.getFileContent();
    expect(content).toContain("codex_hooks = true");
    expect(content).toContain("some_other_flag = true");
  });

  it("should throw a clear error when existing config.toml is malformed", async () => {
    await ensureDir(join(testDir, ".codex"));
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      "this is not = valid = toml [[\n",
    );

    await expect(CodexcliConfigToml.fromBaseDir({ baseDir: testDir })).rejects.toThrow(
      /Failed to parse existing Codex CLI config\.toml/,
    );
  });

  it("should set correct file paths", async () => {
    const configToml = await CodexcliConfigToml.fromBaseDir({ baseDir: testDir });
    expect(configToml.getRelativeDirPath()).toBe(".codex");
    expect(configToml.getRelativeFilePath()).toBe("config.toml");
  });
});
