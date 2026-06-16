import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { VibeConfigToml, VibeHooks } from "./vibe-hooks.js";

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

describe("VibeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getSettablePaths", () => {
    it("should target .vibe/hooks.toml", () => {
      const paths = VibeHooks.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".vibe");
      expect(paths.relativeFilePath).toBe("hooks.toml");
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to a Vibe [[hooks]] TOML array with snake_case events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                {
                  command: "uv run python ./guard-bash",
                  matcher: "bash",
                  timeout: 30,
                  name: "deny-rm-rf",
                  description: "Reject dangerous shell commands.",
                },
              ],
              postToolUse: [{ command: "echo done", matcher: "re:^serena_.*$" }],
              stop: [{ command: "echo turn-end" }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(parsed.hooks)).toBe(true);

      const byType = Object.fromEntries(parsed.hooks.map((h) => [h.type, h]));
      expect(byType.before_tool).toBeDefined();
      expect(byType.before_tool.match).toBe("bash");
      expect(byType.before_tool.command).toBe("uv run python ./guard-bash");
      expect(byType.before_tool.timeout).toBe(30);
      expect(byType.before_tool.name).toBe("deny-rm-rf");
      expect(byType.before_tool.description).toBe("Reject dangerous shell commands.");

      expect(byType.after_tool).toBeDefined();
      expect(byType.after_tool.match).toBe("re:^serena_.*$");

      expect(byType.post_agent_turn).toBeDefined();
      // No matcher provided → defaults to "*".
      expect(byType.post_agent_turn.match).toBe("*");
    });

    it("should drop unsupported events and non-command hook types", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              preToolUse: [
                { type: "command", command: "echo keep" },
                { type: "prompt", command: "summarize" },
              ],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]?.type).toBe("before_tool");
      expect(parsed.hooks[0]?.command).toBe("echo keep");
    });

    it("should carry through the strict flag for tool hooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo guard", strict: true }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks[0]?.strict).toBe(true);
    });

    it("should apply tool-specific vibe overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo shared" }],
            },
            vibe: {
              hooks: {
                preToolUse: [{ command: "echo override" }],
              },
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]?.command).toBe("echo override");
    });

    it("should not write config.toml as a side effect", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({ hooks: { preToolUse: [{ command: "echo x" }] } }),
        }),
      );

      await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const configContent = await readFileContentOrNull(join(testDir, ".vibe", "config.toml"));
      expect(configContent).toBeNull();
    });
  });

  describe("toRulesyncHooks (round-trip import)", () => {
    it("should convert a Vibe hooks.toml back to canonical hooks", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          {
            name: "deny-rm-rf",
            type: "before_tool",
            match: "bash",
            command: "uv run python ./guard-bash",
            timeout: 60,
            strict: false,
            description: "Reject dangerous shell commands.",
          },
          { name: "turn", type: "post_agent_turn", match: "*", command: "echo done" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({
        type: "command",
        command: "uv run python ./guard-bash",
        matcher: "bash",
        timeout: 60,
        name: "deny-rm-rf",
        description: "Reject dangerous shell commands.",
      });
      // A wildcard "*" matcher round-trips to no matcher.
      expect(parsed.hooks.stop?.[0]).toMatchObject({
        type: "command",
        command: "echo done",
      });
      expect(parsed.hooks.stop?.[0]?.matcher).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from .vibe/hooks.toml when it exists", async () => {
      await ensureDir(join(testDir, ".vibe"));
      await writeFileContent(
        join(testDir, ".vibe", "hooks.toml"),
        smolToml.stringify({
          hooks: [{ name: "h", type: "before_tool", match: "bash", command: "echo hi" }],
        }),
      );

      const vibeHooks = await VibeHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
    });

    it("should initialize empty content when hooks.toml does not exist", async () => {
      const vibeHooks = await VibeHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = smolToml.parse(vibeHooks.getFileContent());
      expect(parsed).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("hooks.toml should be deletable", () => {
      const hooks = new VibeHooks(
        createMockAiFileParams({ relativeDirPath: ".vibe", relativeFilePath: "hooks.toml" }),
      );
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});

describe("VibeConfigToml", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should enable experimental hooks", async () => {
    const configToml = await VibeConfigToml.fromOutputRoot({ outputRoot: testDir });
    expect(configToml.getFileContent()).toContain("enable_experimental_hooks = true");
  });

  it("should preserve existing config.toml keys when enabling hooks", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      '[[mcp_servers]]\nname = "myserver"\ncommand = "node"\n',
    );

    const configToml = await VibeConfigToml.fromOutputRoot({ outputRoot: testDir });
    const content = configToml.getFileContent();
    expect(content).toContain("enable_experimental_hooks = true");
    expect(content).toContain("mcp_servers");
    expect(content).toContain("myserver");
  });

  it("should be non-deletable (config holds other Vibe settings)", () => {
    const configToml = new VibeConfigToml({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent: "enable_experimental_hooks = true\n",
    });
    expect(configToml.isDeletable()).toBe(false);
  });

  it("should throw a readable error when existing config.toml is invalid", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), "[features");

    await expect(VibeConfigToml.fromOutputRoot({ outputRoot: testDir })).rejects.toThrow(
      "Failed to parse existing Vibe config",
    );
  });

  it("should set correct file paths", async () => {
    const configToml = await VibeConfigToml.fromOutputRoot({ outputRoot: testDir });
    expect(configToml.getRelativeDirPath()).toBe(".vibe");
    expect(configToml.getRelativeFilePath()).toBe("config.toml");
  });
});
