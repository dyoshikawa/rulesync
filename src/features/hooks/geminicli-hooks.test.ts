import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readOrInitializeFileContent, ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminicliHooks } from "./geminicli-hooks.js";
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

describe("GeminicliHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromRulesyncHooks", () => {
    it("should filter unsupported events and convert to Gemini CLI format", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [
                { command: "echo start", name: "Start Hook", description: "Runs on start" },
              ],
              unsupportedEvent: [{ command: "echo ignored" }],
            },
          }),
        }),
      );

      const geminiHooks = await GeminicliHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(geminiHooks.getFileContent());
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo start");
      expect(parsed.hooks.SessionStart[0].hooks[0].name).toBe("Start Hook");
      expect(parsed.hooks.SessionStart[0].hooks[0].description).toBe("Runs on start");
      expect(parsed.hooks.UnsupportedEvent).toBeUndefined();
    });

    it("should prefix dot-relative commands with $GEMINI_PROJECT_DIR", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "./hooks/start.sh" }],
            },
          }),
        }),
      );

      const geminiHooks = await GeminicliHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(geminiHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        "$GEMINI_PROJECT_DIR/hooks/start.sh",
      );
    });

    it("should merge with existing settings.json", async () => {
      const mockSettings = {
        theme: "dark",
        hooks: {
          OldEvent: [{ hooks: [{ command: "old" }] }],
        },
      };

      const settingsPath = join(testDir, ".gemini", "settings.json");
      await ensureDir(join(testDir, ".gemini"));
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

      const geminiHooks = await GeminicliHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(geminiHooks.getFileContent());
      expect(parsed.theme).toBe("dark");
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.OldEvent).toBeUndefined(); // Existing hooks are overwritten by Rulesync
    });

    it("should process overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
            },
            geminicli: {
              hooks: {
                sessionStart: [{ command: "echo override" }],
                sessionEnd: [{ command: "echo end" }],
              },
            },
          }),
        }),
      );

      const geminiHooks = await GeminicliHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(geminiHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo override");
      expect(parsed.hooks.SessionEnd[0].hooks[0].command).toBe("echo end");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Gemini CLI format to canonical format", () => {
      const geminiHooks = new GeminicliHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: [
                {
                  matcher: "init",
                  hooks: [
                    {
                      type: "command",
                      command: "$GEMINI_PROJECT_DIR/echo start",
                      timeout: 1000,
                      name: "Start Hook",
                      description: "Runs on start",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = geminiHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "./echo start",
        timeout: 1000,
        matcher: "init",
        name: "Start Hook",
        description: "Runs on start",
      });
    });

    it("should handle missing optional fields", () => {
      const geminiHooks = new GeminicliHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              SessionEnd: [
                {
                  hooks: [
                    {
                      command: "echo end",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = geminiHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionEnd).toBeDefined();
      expect(parsed.hooks.sessionEnd?.[0]).toEqual({
        type: "command",
        command: "echo end",
      });
    });

    it("should ignore invalid entries", () => {
      const geminiHooks = new GeminicliHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: "invalid", // Not an array
              SessionEnd: [
                "invalid", // Not an object
                { hooks: "invalid" }, // hooks is not an array
              ],
            },
          }),
        }),
      );

      const rulesyncHooks = geminiHooks.toRulesyncHooks();
      const parsed = rulesyncHooks.getJson();

      expect(parsed.hooks.sessionStart).toBeUndefined();
      expect(parsed.hooks.sessionEnd).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from .gemini/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini", "settings.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "$GEMINI_PROJECT_DIR/echo start" }] },
            ],
          },
        }),
      );

      const geminiHooks = await GeminicliHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(geminiHooks).toBeInstanceOf(GeminicliHooks);
      const content = geminiHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when settings.json does not exist", async () => {
      const geminiHooks = await GeminicliHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(geminiHooks).toBeInstanceOf(GeminicliHooks);
      const content = geminiHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new GeminicliHooks(createMockAiFileParams());
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create instance with empty hooks", () => {
      const hooks = GeminicliHooks.forDeletion({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
      });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
