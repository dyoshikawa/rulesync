import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroHooks } from "./kiro-hooks.js";
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

describe("KiroHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromRulesyncHooks", () => {
    it("should filter unsupported events and convert to Kiro CLI format", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              unsupportedEvent: [{ command: "echo ignored" }],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.agentSpawn).toBeDefined();
      expect(parsed.hooks.agentSpawn[0].command).toBe("echo start");
      expect(parsed.hooks.UnsupportedEvent).toBeUndefined();
    });

    it("should drop standalone-format triggers from the shared kiro override block", async () => {
      const logger = createMockLogger();
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: { sessionStart: [{ command: "echo start" }] },
            // The `kiro` block is shared with the standalone-format targets
            // (kiro-cli / kiro-ide). `PostFileSave` belongs to that format's
            // trigger vocabulary and is not an event this agent config defines,
            // while `userPromptSubmit` is one of its own native spellings.
            kiro: {
              hooks: {
                PostFileSave: [{ command: "echo saved" }],
                userPromptSubmit: [{ command: "echo prompt" }],
              },
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
        logger,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.agentSpawn[0].command).toBe("echo start");
      expect(parsed.hooks.userPromptSubmit[0].command).toBe("echo prompt");
      expect(parsed.hooks.PostFileSave).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("PostFileSave"));
    });

    it("should keep agent-config-native event keys that have no canonical equivalent", async () => {
      const logger = createMockLogger();
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {},
            // `fileEdited` / `fileCreated` exist only in this format's own
            // vocabulary, so the shared-block filter must not drop them.
            kiro: {
              hooks: {
                fileEdited: [{ command: "echo edited" }],
                fileCreated: [{ command: "echo created" }],
              },
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
        logger,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.fileEdited[0].command).toBe("echo edited");
      expect(parsed.hooks.fileCreated[0].command).toBe("echo created");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should map canonical event names to Kiro CLI event names", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              sessionEnd: [{ command: "echo end" }],
              beforeSubmitPrompt: [{ command: "echo prompt" }],
              preToolUse: [{ command: "echo pre", matcher: "Bash" }],
              postToolUse: [{ command: "echo post" }],
              stop: [{ command: "echo stop" }],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.agentSpawn).toBeDefined();
      expect(parsed.hooks.userPromptSubmit).toBeDefined();
      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.postToolUse).toBeDefined();
      // Both sessionEnd and stop map to kiro's stop and are merged.
      expect(parsed.hooks.stop).toBeDefined();
      expect(parsed.hooks.stop).toHaveLength(2);
      expect(parsed.hooks.stop[0].command).toBe("echo end");
      expect(parsed.hooks.stop[1].command).toBe("echo stop");
    });

    it("should include matcher and timeout_ms in output", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo check", matcher: "Bash", timeout: 5000 }],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.preToolUse[0].command).toBe("echo check");
      expect(parsed.hooks.preToolUse[0].matcher).toBe("Bash");
      expect(parsed.hooks.preToolUse[0].timeout_ms).toBe(5000);
    });

    it("should emit cacheTtl as cache_ttl_seconds", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              beforeSubmitPrompt: [{ command: "echo context", cacheTtl: 60 }],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.userPromptSubmit[0].cache_ttl_seconds).toBe(60);
    });

    it("should skip prompt-type hooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [
                { type: "prompt", prompt: "hello" },
                { type: "command", command: "echo start" },
              ],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.agentSpawn).toHaveLength(1);
      expect(parsed.hooks.agentSpawn[0].command).toBe("echo start");
    });

    it("should merge with existing default.json", async () => {
      const mockConfig = {
        allowedTools: ["web_fetch", "web_search"],
        hooks: {
          oldEvent: [{ command: "old" }],
        },
      };

      const configPath = join(testDir, ".kiro", "agents", "default.json");
      await ensureDir(join(testDir, ".kiro", "agents"));
      await writeFileContent(configPath, JSON.stringify(mockConfig));

      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.allowedTools).toEqual(["web_fetch", "web_search"]);
      expect(parsed.hooks.agentSpawn).toBeDefined();
      // Existing hooks are overwritten by Rulesync
      expect(parsed.hooks.oldEvent).toBeUndefined();
    });

    it("should process overrides from config.kiro.hooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
            kiro: {
              hooks: {
                sessionStart: [{ command: "echo override" }],
                stop: [{ command: "echo stop" }],
              },
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.agentSpawn[0].command).toBe("echo override");
      expect(parsed.hooks.stop[0].command).toBe("echo stop");
    });

    it("should include name and description fields", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [
                { command: "echo start", name: "Start Hook", description: "Runs on start" },
              ],
            },
          }),
        }),
      );

      const kiroHooks = await KiroHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(kiroHooks.getFileContent());
      expect(parsed.hooks.agentSpawn[0].name).toBe("Start Hook");
      expect(parsed.hooks.agentSpawn[0].description).toBe("Runs on start");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Kiro CLI format to canonical format", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              agentSpawn: [
                {
                  command: "echo start",
                  matcher: "",
                  timeout_ms: 1000,
                  name: "Start Hook",
                  description: "Runs on start",
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "echo start",
        timeout: 1000,
        name: "Start Hook",
        description: "Runs on start",
      });
    });

    it("should convert preToolUse with matcher", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                {
                  command: "echo check",
                  matcher: "Bash",
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "command",
        command: "echo check",
        matcher: "Bash",
      });
    });

    it("should import cache_ttl_seconds as cacheTtl", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              userPromptSubmit: [{ command: "echo context", cache_ttl_seconds: 60 }],
            },
          }),
        }),
      );

      const parsed = kiroHooks.toRulesyncHooks().getJson();

      expect(parsed.hooks.beforeSubmitPrompt?.[0]).toMatchObject({
        command: "echo context",
        cacheTtl: 60,
      });
    });

    it("should map Kiro CLI stop event to canonical stop", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              stop: [{ command: "echo done" }],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.stop).toBeDefined();
      expect(parsed.hooks.stop?.[0]?.command).toBe("echo done");
    });

    it("should skip entries without a command", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              stop: [{ matcher: "test" }, { command: "echo good" }],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.stop).toHaveLength(1);
      expect(parsed.hooks.stop?.[0]?.command).toBe("echo good");
    });

    it("should ignore invalid entries", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              agentSpawn: "invalid",
              stop: ["invalid", { hooks: "invalid" }, 123],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeUndefined();
      expect(parsed.hooks.stop).toBeUndefined();
    });

    it("should route unknown event names into the kiro override block", () => {
      const kiroHooks = new KiroHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              someUnknownEvent: [{ command: "echo unknown" }],
            },
          }),
        }),
      );

      const rulesyncHooks = kiroHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      // Unknown native keys must not land in the top-level hooks record (whose
      // keys are restricted to canonical event names) but under the kiro
      // override block, so the imported file passes canonical validation.
      expect(parsed.hooks.someUnknownEvent).toBeUndefined();
      const overrideHooks = (parsed as { kiro?: { hooks?: Record<string, unknown[]> } }).kiro
        ?.hooks;
      expect(overrideHooks?.someUnknownEvent?.[0]).toMatchObject({ command: "echo unknown" });
    });
  });

  describe("fromFile", () => {
    it("should load from .kiro/agents/default.json when it exists", async () => {
      await ensureDir(join(testDir, ".kiro", "agents"));
      await writeFileContent(
        join(testDir, ".kiro", "agents", "default.json"),
        JSON.stringify({
          hooks: {
            agentSpawn: [{ command: "echo start" }],
          },
        }),
      );

      const kiroHooks = await KiroHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(kiroHooks).toBeInstanceOf(KiroHooks);
      const content = kiroHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.agentSpawn).toHaveLength(1);
    });

    it("should initialize empty config when default.json does not exist", async () => {
      const kiroHooks = await KiroHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(kiroHooks).toBeInstanceOf(KiroHooks);
      const content = kiroHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new KiroHooks(createMockAiFileParams());
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create instance with empty config", () => {
      const hooks = KiroHooks.forDeletion({
        relativeDirPath: join(".kiro", "agents"),
        relativeFilePath: "default.json",
      });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed).toEqual({ hooks: {} });
    });
  });
});
