import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
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

      expect(paths.relativeDirPath).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(paths.relativeFilePath).toBe(RULESYNC_PERMISSIONS_FILE_NAME);
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
});
