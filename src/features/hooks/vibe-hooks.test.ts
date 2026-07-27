import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { VibeHooks } from "./vibe-hooks.js";

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
      expect(byType.pre_tool).toBeDefined();
      expect(byType.pre_tool.match).toBe("bash");
      expect(byType.pre_tool.command).toBe("uv run python ./guard-bash");
      expect(byType.pre_tool.timeout).toBe(30);
      expect(byType.pre_tool.name).toBe("deny-rm-rf");
      expect(byType.pre_tool.description).toBe("Reject dangerous shell commands.");

      expect(byType.post_tool).toBeDefined();
      expect(byType.post_tool.match).toBe("re:^serena_.*$");

      expect(byType.post_agent).toBeDefined();
      // `match` applies to tool hooks only; post_agent carries no matcher.
      expect(byType.post_agent.match).toBeUndefined();
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
      expect(parsed.hooks[0]?.type).toBe("pre_tool");
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
            type: "pre_tool",
            match: "bash",
            command: "uv run python ./guard-bash",
            timeout: 60,
            strict: false,
            description: "Reject dangerous shell commands.",
          },
          { name: "turn", type: "post_agent", match: "*", command: "echo done" },
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
          hooks: [{ name: "h", type: "pre_tool", match: "bash", command: "echo hi" }],
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
