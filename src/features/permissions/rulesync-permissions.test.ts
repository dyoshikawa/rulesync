import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger, type Logger } from "../../utils/logger.js";
import {
  RulesyncPermissions,
  type RulesyncPermissionsFromFileParams,
  type RulesyncPermissionsParams,
} from "./rulesync-permissions.js";

const makeInstance = (json: Record<string, unknown>) =>
  new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(json),
  });

const imported = (params: { fileContent: string; sourcePath?: string; logger?: Logger }): string =>
  RulesyncPermissions.fromImportedFileContent({
    outputRoot: ".",
    ...params,
  }).getFileContent();

describe("RulesyncPermissions", () => {
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

  describe("constructor", () => {
    it("should create instance with valid permissions config", () => {
      const validContent = JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
        },
      });

      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: validContent,
      });

      expect(instance).toBeInstanceOf(RulesyncPermissions);
      expect(instance.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(instance.getRelativeFilePath()).toBe(RULESYNC_PERMISSIONS_FILE_NAME);
      expect(instance.getFileContent()).toBe(validContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validContent = JSON.stringify({
        permission: {},
      });

      const instance = new RulesyncPermissions({
        outputRoot: "/custom/path",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: validContent,
      });

      expect(instance.getOutputRoot()).toBe("/custom/path");
      expect(instance.getFilePath()).toBe(
        `/custom/path/${RULESYNC_RELATIVE_DIR_PATH}/${RULESYNC_PERMISSIONS_FILE_NAME}`,
      );
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        permission: {
          bash: { "*": "ask", "git *": "allow", "rm *": "deny" },
          edit: { "*": "deny", "src/**": "allow" },
        },
      };
      const validContent = JSON.stringify(jsonData);

      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: validContent,
      });

      expect(instance.getJson()).toEqual(jsonData);
    });

    it("should validate content by default", () => {
      const validContent = JSON.stringify({
        permission: {},
      });

      expect(() => {
        const _instance = new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: validContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validContent = JSON.stringify({
        permission: {},
      });

      expect(() => {
        const _instance = new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: validContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      expect(() => {
        const _instance = new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: "{ invalid json }",
        });
      }).toThrow(SyntaxError);
    });

    it("should handle validation failure when validate is true", () => {
      class TestRulesyncPermissions extends RulesyncPermissions {
        validate(): ValidationResult {
          return {
            success: false,
            error: new Error("Validation failed"),
          };
        }
      }

      const validContent = JSON.stringify({
        permission: {},
      });

      expect(() => {
        const _instance = new TestRulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: validContent,
          validate: true,
        });
      }).toThrow("Validation failed");
    });

    it("should skip validation failure when validate is false", () => {
      class TestRulesyncPermissions extends RulesyncPermissions {
        validate(): ValidationResult {
          return {
            success: false,
            error: new Error("Validation failed"),
          };
        }
      }

      const validContent = JSON.stringify({
        permission: {},
      });

      expect(() => {
        const _instance = new TestRulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: validContent,
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    // A pattern named after a prototype member is removed by the parser before
    // the schema can see it, so it used to produce neither an error nor an
    // entry in any generated file. These pin the report that replaced that
    // silence.
    it("should reject a permission pattern named after a prototype member", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        // Written as raw text: a `__proto__` key in an object literal sets the
        // prototype instead of becoming a property, so it would never survive
        // JSON.stringify to reach the parser under test.
        fileContent: '{"permission": {"bash": {"__proto__": "deny", "git *": "allow"}}}',
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("permission.bash.__proto__");
      expect(result.error?.message).toContain(
        join(RULESYNC_RELATIVE_DIR_PATH, RULESYNC_PERMISSIONS_FILE_NAME),
      );
      expect(result.error?.message).toContain("rename them");
    });

    it("should list every dropped key rather than only the first", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: '{"permission": {"bash": {"__proto__": "deny", "constructor": "allow"}}}',
        validate: false,
      });

      const result = instance.validate();

      expect(result.error?.message).toContain("permission.bash.__proto__");
      expect(result.error?.message).toContain("permission.bash.constructor");
    });

    it("should throw from the constructor when validation is enabled", () => {
      expect(
        () =>
          new RulesyncPermissions({
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
            fileContent: '{"permission": {"bash": {"__proto__": "deny"}}}',
            validate: true,
          }),
      ).toThrow("permission.bash.__proto__");
    });

    it.each([
      ["an empty pattern", ""],
      ["a whitespace-only pattern", "   "],
    ])("should reject %s", (_label, pattern) => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: { bash: { [pattern]: "allow" } } }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(false);
    });

    it("should reject a blank pattern in a tool-scoped permission block", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          claudecode: { permission: { bash: { "": "allow" } } },
        }),
        validate: false,
      });

      expect(instance.validate().success).toBe(false);
    });

    it.each([
      ["an empty category", ""],
      ["a whitespace-only category", "   "],
    ])("should reject %s in the shared block", (_label, category) => {
      // Every translator reads categories by name, so the rules under a blank
      // one reach no tool at all.
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: { [category]: { "git *": "allow" } } }),
        validate: false,
      });

      expect(instance.validate().success).toBe(false);
    });

    it("should reject a blank category in a tool-scoped permission block", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          claudecode: { permission: { "": { "git *": "allow" } } },
        }),
        validate: false,
      });

      expect(instance.validate().success).toBe(false);
    });

    it("should reject a blank category in an OpenCode tool-scoped block", () => {
      // OpenCode's tool-scoped categories accept a bare action string as well
      // as a rules map, so they carry their own record schema.
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          opencode: { permission: { "  ": "deny" } },
        }),
        validate: false,
      });

      expect(instance.validate().success).toBe(false);
    });

    it("should reject a blank category in a Vibe tool-scoped block", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          vibe: { permission: { "": { sensitive_patterns: ["rm *"] } } },
        }),
        validate: false,
      });

      expect(instance.validate().success).toBe(false);
    });

    it.each([["roo"], ["zoocode"]])(
      "should reject a blank key in the %s tool-scoped block",
      (toolKey) => {
        // These two targets are permissions-capable and their blocks are read
        // by the central merge, but they had no entry here, so `looseObject`
        // let anything through and a blank pattern reached the generated file
        // — wiping the deny list the tool's own config already had.
        const instance = new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({
            permission: {},
            [toolKey]: { permission: { bash: { "   ": "deny" } } },
          }),
          validate: false,
        });

        expect(instance.validate().success).toBe(false);
      },
    );

    it("should return successful validation result for valid config", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: {} }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should pass validation when $schema field is present", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          $schema: RULESYNC_PERMISSIONS_SCHEMA_URL,
          permission: {
            bash: { "*": "ask" },
          },
        }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should pass validation with all permission action types", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: {
              "git *": "allow",
              "*": "ask",
              "rm -rf *": "deny",
            },
          },
        }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation for invalid permission action", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "*": "invalid_action" },
          },
        }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it("should accept additional unknown top-level fields (looseObject)", () => {
      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          unknownField: "should be accepted",
        }),
        validate: false,
      });

      const result = instance.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths", () => {
      const paths = RulesyncPermissions.getSettablePaths();

      expect(paths.recommended.relativeDirPath).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(paths.recommended.relativeFilePath).toBe(RULESYNC_PERMISSIONS_FILE_NAME);
    });
  });

  describe("getJson", () => {
    it("should return parsed JSON object", () => {
      const jsonData = {
        permission: {
          bash: { "*": "ask", "git *": "allow" },
          edit: { "src/**": "allow" },
        },
      };

      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify(jsonData),
      });

      expect(instance.getJson()).toEqual(jsonData);
    });

    it("should return empty permission object", () => {
      const jsonData = { permission: {} };

      const instance = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify(jsonData),
      });

      expect(instance.getJson()).toEqual(jsonData);
    });
  });

  describe("forTarget", () => {
    it("should return the same instance when no tool-scoped permission exists", () => {
      const instance = makeInstance({ permission: { bash: { "*": "ask" } } });

      expect(instance.forTarget({ toolTarget: "claudecode" })).toBe(instance);
    });

    it("should merge the tool-scoped permission over the shared block per category", () => {
      const instance = makeInstance({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
          edit: { "src/**": "allow" },
        },
        claudecode: {
          permission: { bash: { "git push *": "deny" } },
          permissions: { defaultMode: "acceptEdits" },
        },
      });

      const effective = instance.forTarget({ toolTarget: "claudecode" });
      const json = effective.getJson();

      // Tool-scoped category replaces the shared category wholesale.
      expect(json.permission).toEqual({
        bash: { "git push *": "deny" },
        edit: { "src/**": "allow" },
      });
      // The consumed `permission` key is stripped; other override keys stay.
      expect(json.claudecode).toEqual({ permissions: { defaultMode: "acceptEdits" } });
    });

    it("should not apply another tool's scoped permission", () => {
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        claudecode: { permission: { bash: { "*": "allow" } } },
      });

      const effective = instance.forTarget({ toolTarget: "cursor" });

      expect(effective).toBe(instance);
    });

    it("should drop the override block entirely when permission was its only key", () => {
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        zed: { permission: { bash: { "*": "allow" } } },
      });

      const json = instance.forTarget({ toolTarget: "zed" }).getJson();

      expect(json.permission).toEqual({ bash: { "*": "allow" } });
      expect(json.zed).toBeUndefined();
    });

    it("should alias kiro-cli and kiro-ide to the kiro override key", () => {
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        kiro: { permission: { bash: { "*": "deny" } } },
      });

      expect(instance.forTarget({ toolTarget: "kiro-cli" }).getJson().permission).toEqual({
        bash: { "*": "deny" },
      });
      expect(instance.forTarget({ toolTarget: "kiro-ide" }).getJson().permission).toEqual({
        bash: { "*": "deny" },
      });
      expect(instance.forTarget({ toolTarget: "kiro" }).getJson().permission).toEqual({
        bash: { "*": "deny" },
      });
    });

    it("should warn when a block is authored under an alias source name", () => {
      const logger = { warn: vi.fn() } as any;
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        "kiro-cli": { permission: { bash: { "*": "allow" } } },
      });

      const effective = instance.forTarget({ toolTarget: "kiro-cli", logger });

      // The block under the alias SOURCE name is ignored, but not silently.
      expect(effective.getJson().permission).toEqual({ bash: { "*": "ask" } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro"'));
    });

    it("should alias hermesagent to the hermes override key", () => {
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        hermes: { permission: { webfetch: { "*": "deny" } } },
      });

      const json = instance.forTarget({ toolTarget: "hermesagent" }).getJson();

      expect(json.permission).toEqual({ bash: { "*": "ask" }, webfetch: { "*": "deny" } });
      expect(json.hermes).toBeUndefined();
    });

    it("should leave OpenCode/Kilo/Vibe native permission overrides untouched", () => {
      const instance = makeInstance({
        permission: { bash: { "*": "ask" } },
        opencode: { permission: { external_directory: "deny" } },
        kilo: { permission: { doom_loop: "ask" } },
        vibe: { permission: { bash: { sensitive_patterns: ["rm *"] } } },
      });

      expect(instance.forTarget({ toolTarget: "opencode" })).toBe(instance);
      expect(instance.forTarget({ toolTarget: "kilo" })).toBe(instance);
      expect(instance.forTarget({ toolTarget: "vibe" })).toBe(instance);
    });
  });

  describe("fromFile", () => {
    it("should load permissions.jsonc with comments", async () => {
      const jsoncPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.jsonc");
      const jsoncContent = `{
        // canonical shared permission block
        "permission": {
          "bash": { "git *": "allow", },
        },
      }`;

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(jsoncPath, jsoncContent);

      const instance = await RulesyncPermissions.fromFile({ validate: true });

      expect(instance.getRelativeFilePath()).toBe("permissions.jsonc");
      expect(instance.getJson()).toEqual({ permission: { bash: { "git *": "allow" } } });
    });

    it("should prefer permissions.jsonc over permissions.json when both exist", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, RULESYNC_PERMISSIONS_FILE_NAME),
        JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      );
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.jsonc"),
        JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      );

      const instance = await RulesyncPermissions.fromFile({ validate: true });

      expect(instance.getRelativeFilePath()).toBe("permissions.jsonc");
      expect(instance.getJson()).toEqual({ permission: { bash: { "*": "allow" } } });
    });

    it("should create RulesyncPermissions from existing file", async () => {
      const permissionsPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_PERMISSIONS_FILE_NAME,
      );
      const jsonData = {
        permission: {
          bash: { "*": "ask", "git *": "allow" },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(permissionsPath, JSON.stringify(jsonData, null, 2));

      const instance = await RulesyncPermissions.fromFile({ validate: true });

      expect(instance).toBeInstanceOf(RulesyncPermissions);
      expect(instance.getJson()).toEqual(jsonData);
      expect(instance.getOutputRoot()).toBe(testDir);
      expect(instance.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(instance.getRelativeFilePath()).toBe(RULESYNC_PERMISSIONS_FILE_NAME);
    });

    it("should create RulesyncPermissions from file with validation disabled", async () => {
      const permissionsPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_PERMISSIONS_FILE_NAME,
      );
      const jsonData = {
        permission: {
          edit: { "*": "deny" },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(permissionsPath, JSON.stringify(jsonData));

      const instance = await RulesyncPermissions.fromFile({ validate: false });

      expect(instance).toBeInstanceOf(RulesyncPermissions);
      expect(instance.getJson()).toEqual(jsonData);
    });

    it("should use validation by default", async () => {
      const permissionsPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_PERMISSIONS_FILE_NAME,
      );
      const jsonData = { permission: {} };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(permissionsPath, JSON.stringify(jsonData));

      const instance = await RulesyncPermissions.fromFile({});

      expect(instance).toBeInstanceOf(RulesyncPermissions);
      expect(instance.getJson()).toEqual(jsonData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(RulesyncPermissions.fromFile({ validate: true })).rejects.toThrow();
    });

    it("should throw error for invalid JSON in file", async () => {
      const permissionsPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_PERMISSIONS_FILE_NAME,
      );

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(permissionsPath, "{ invalid json }");

      await expect(RulesyncPermissions.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should throw error for empty file", async () => {
      const permissionsPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_PERMISSIONS_FILE_NAME,
      );

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(permissionsPath, "");

      await expect(RulesyncPermissions.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });
  });

  describe("type exports", () => {
    it("should export RulesyncPermissionsParams type", () => {
      const params: RulesyncPermissionsParams = {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: {} }),
      };

      expect(params).toBeDefined();
    });

    it("should export RulesyncPermissionsFromFileParams type", () => {
      const params: RulesyncPermissionsFromFileParams = {
        validate: true,
      };

      expect(params).toBeDefined();
    });
  });

  describe("RulesyncPermissions.fromImportedFileContent", () => {
    it("should drop a blank pattern so the imported file passes validation", () => {
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "": "allow", "git *": "allow" } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({ permission: { bash: { "git *": "allow" } } });
      expect(
        new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent,
          validate: false,
        }).validate().success,
      ).toBe(true);
    });

    it("should return the content unchanged when no pattern is blank", () => {
      const fileContent = JSON.stringify({ permission: { bash: { "git *": "allow" } } });

      expect(imported({ fileContent })).toBe(fileContent);
    });

    it("should return the content unchanged when there is no permission block", () => {
      const fileContent = JSON.stringify({ claudecode: { defaultMode: "plan" } });

      expect(imported({ fileContent })).toBe(fileContent);
    });

    it("should leave a category whose value is not a rules map alone", () => {
      const fileContent = JSON.stringify({ permission: { bash: "allow" } });

      expect(imported({ fileContent })).toBe(fileContent);
    });

    it("should warn with the count per category for every dropped pattern", () => {
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({
          permission: {
            bash: { "": "allow", "   ": "deny", "git *": "allow" },
            read: { "\t": "allow" },
          },
        }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const message = logger.warn.mock.calls[0]?.[0];
      expect(message).toContain('2 in "permission.bash"');
      expect(message).toContain('1 in "permission.read"');
    });

    it("should name the tool config the patterns came out of", () => {
      // One import run reads many tools and the block paths are the same for
      // all of them, so the source file is the first thing the user needs.
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({ permission: { bash: { "": "allow" } } }),
        sourcePath: ".claude/settings.json",
        logger,
      });

      expect(logger.warn.mock.calls[0]?.[0]).toContain('".claude/settings.json"');
    });

    it("should not warn when nothing was dropped", () => {
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should drop a blank pattern from a tool-scoped permission block", () => {
      // A tool-scoped block is a category-to-pattern-map like the shared one,
      // so the same blank pattern can land there.
      const logger = createMockLogger();

      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          claudecode: { permission: { bash: { "": "deny", "git push *": "deny" } } },
        }),
        logger,
      });

      expect(JSON.parse(fileContent)).toEqual({
        permission: { bash: { "git *": "allow" } },
        claudecode: { permission: { bash: { "git push *": "deny" } } },
      });
      expect(logger.warn.mock.calls[0]?.[0]).toContain('1 in "claudecode.permission.bash"');
      expect(
        new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent,
          validate: false,
        }).validate().success,
      ).toBe(true);
    });

    it("should leave tool-native shapes in a tool-scoped block untouched", () => {
      // A bare action string has no pattern key to inspect and `sandbox` is not
      // a permission block at all.
      const fileContent = JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        opencode: { permission: { external_directory: "deny" } },
        kilo: { sandbox: { enabled: true } },
      });

      expect(imported({ fileContent })).toBe(fileContent);
    });

    it("should leave Vibe's tool-scoped block untouched and unreported", () => {
      // `vibe.permission.<category>` holds `{ sensitive_patterns: [...] }`
      // objects, so a key inside one is a field name, not a pattern. Walking it
      // would drop the field and report it as a removed permission pattern.
      const logger = createMockLogger();
      const fileContent = JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        vibe: { permission: { bash: { sensitive_patterns: ["rm *"], "  ": [] } } },
      });

      expect(imported({ fileContent, logger })).toBe(fileContent);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should drop a category the filter emptied", () => {
      // Writing back `{"bash": {}}` would put an empty category into the tool's
      // own config on the next generate.
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "": "allow" }, read: { "src/**": "allow" } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({ permission: { read: { "src/**": "allow" } } });
    });

    it("should drop a tool key whose whole permission block the filter emptied", () => {
      // Leaving `"claudecode": {"permission": {}}` behind reads as an empty
      // override to whoever opens the file next, and there is nothing else
      // under the key to keep it alive.
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
          claudecode: { permission: { bash: { "  ": "deny" } } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({ permission: { bash: { "npm *": "allow" } } });
    });

    it("should keep a tool key that carries more than the emptied permission block", () => {
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "npm *": "allow" } },
          claudecode: { defaultMode: "plan", permission: { bash: { "  ": "deny" } } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({
        permission: { bash: { "npm *": "allow" } },
        claudecode: { defaultMode: "plan" },
      });
    });

    it("should drop a blank category so the imported file passes validation", () => {
      // OpenCode and Kilo copy a category they do not recognize into the
      // tool-scoped block verbatim, so a blank one in the user's own config
      // reaches here. Reproducing it would write a source file the next
      // generate refuses outright, taking every tool's permissions with it.
      const logger = createMockLogger();

      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          opencode: { permission: { "  ": "deny", external_directory: "deny" } },
        }),
        logger,
      });

      expect(JSON.parse(fileContent)).toEqual({
        permission: { bash: { "git *": "allow" } },
        opencode: { permission: { external_directory: "deny" } },
      });
      expect(logger.warn.mock.calls[0]?.[0]).toContain("Dropped blank permission categories");
      expect(logger.warn.mock.calls[0]?.[0]).toContain('1 in "opencode.permission"');
      expect(
        new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent,
          validate: false,
        }).validate().success,
      ).toBe(true);
    });

    it("should escape control characters in a category name it reports", () => {
      // The block paths embed category names taken from the tool's own config.
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({
          permission: { "ba\nsh": { "  ": "deny", "git *": "allow" } },
        }),
        logger,
      });

      const warning = String(logger.warn.mock.calls[0]?.[0]);
      expect(warning).not.toContain("\nsh");
      expect(warning).toContain('1 in "permission.ba\\nsh"');
    });

    it("should drop a blank category from the shared block", () => {
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { "   ": { "git *": "allow" }, bash: { "npm *": "allow" } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({ permission: { bash: { "npm *": "allow" } } });
    });

    it("should drop a blank category from Vibe's block even though its patterns are left alone", () => {
      // The keys one level down are field names there, but the category names
      // above them are category names like any other.
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
          vibe: { permission: { "": { sensitive_patterns: [] }, bash: { "  ": [] } } },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({
        permission: { bash: { "git *": "allow" } },
        vibe: { permission: { bash: { "  ": [] } } },
      });
    });

    it("should report dropped patterns and dropped categories separately", () => {
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({
          permission: { "": { "git *": "allow" }, bash: { "  ": "deny", "npm *": "allow" } },
        }),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[0]?.[0]).toContain('1 in "permission.bash"');
      expect(logger.warn.mock.calls[1]?.[0]).toContain('1 in "permission"');
    });

    it("should keep a tool-scoped permission block that was already empty", () => {
      // Nothing here was dropped from it, so it is not this filter's to remove.
      const fileContent = imported({
        fileContent: JSON.stringify({
          permission: { bash: { "": "allow", "npm *": "allow" } },
          claudecode: { permission: {} },
        }),
      });

      expect(JSON.parse(fileContent)).toEqual({
        permission: { bash: { "npm *": "allow" } },
        claudecode: { permission: {} },
      });
    });

    it("should keep a category that was already empty", () => {
      // Nothing here was dropped from it, so it is not this filter's to remove.
      const fileContent = imported({
        fileContent: JSON.stringify({ permission: { bash: { "": "allow" }, read: {} } }),
      });

      expect(JSON.parse(fileContent)).toEqual({ permission: { read: {} } });
    });

    it("should label the shared block in the warning", () => {
      const logger = createMockLogger();

      imported({
        fileContent: JSON.stringify({ permission: { bash: { "": "allow" } } }),
        logger,
      });

      expect(logger.warn.mock.calls[0]?.[0]).toContain('1 in "permission.bash"');
    });

    it("should warn through the shared fallback logger when no logger is supplied", () => {
      // The import direction (`toRulesyncPermissions`) takes no logger
      // parameter, so this is the path every real caller uses today.
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      imported({
        fileContent: JSON.stringify({ permission: { bash: { "": "allow" } } }),
      });

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
