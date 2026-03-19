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

    it("should create instance with custom baseDir", () => {
      const validContent = JSON.stringify({
        permission: {},
      });

      const instance = new RulesyncPermissions({
        baseDir: "/custom/path",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: validContent,
      });

      expect(instance.getBaseDir()).toBe("/custom/path");
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

  describe("fromFile", () => {
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
      expect(instance.getBaseDir()).toBe(testDir);
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
