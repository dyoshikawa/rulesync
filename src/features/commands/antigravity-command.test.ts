import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AntigravityCommand, AntigravityCommandFrontmatter } from "./antigravity-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("AntigravityCommand", () => {
  describe("constructor", () => {
    it("should create an AntigravityCommand with valid frontmatter", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Test workflow",
      };
      const body = "This is a test workflow body";

      const command = new AntigravityCommand({
        baseDir: ".",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "test.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
      expect(command.getRelativeDirPath()).toBe(".agent/workflows");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should validate frontmatter when validation is enabled", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid: should be string
      };

      expect(() => {
        new AntigravityCommand({
          baseDir: ".",
          relativeDirPath: ".agent/workflows",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter as any,
          body: "test body",
          fileContent: "test content",
          validate: true,
        });
      }).toThrow();
    });

    it("should skip validation when validation is disabled", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid: should be string
      };

      expect(() => {
        new AntigravityCommand({
          baseDir: ".",
          relativeDirPath: ".agent/workflows",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter as any,
          body: "test body",
          fileContent: "test content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Valid workflow",
      };

      const command = new AntigravityCommand({
        baseDir: ".",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "test.md",
        frontmatter,
        body: "test body",
        fileContent: stringifyFrontmatter("test body", frontmatter),
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new AntigravityCommand({
        baseDir: ".",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 } as any,
        body: "test body",
        fileContent: "test content",
        validate: false, // Skip validation in constructor
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return success when frontmatter is undefined", () => {
      const command = new AntigravityCommand({
        baseDir: ".",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "test.md",
        frontmatter: { description: "test" },
        body: "test body",
        fileContent: "test content",
        validate: false,
      });

      // Set frontmatter to undefined via type assertion for testing
      (command as any).frontmatter = undefined;

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert AntigravityCommand to RulesyncCommand", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Test workflow for conversion",
      };
      const body = "This workflow will be converted";

      const antigravityCommand = new AntigravityCommand({
        baseDir: "/test/base",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "convert-test.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = antigravityCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe(body);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["antigravity"],
        description: frontmatter.description,
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncCommand.getBaseDir()).toBe(".");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create AntigravityCommand from RulesyncCommand", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Converted from rulesync",
      };
      const body = "Workflow converted from rulesync";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "from-rulesync.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        baseDir: "/converted/base",
        rulesyncCommand,
        validate: true,
      });

      expect(antigravityCommand).toBeInstanceOf(AntigravityCommand);
      expect(antigravityCommand.getBody()).toBe(body);
      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: rulesyncFrontmatter.description,
      });
      expect(antigravityCommand.getRelativeDirPath()).toBe(".agent/workflows");
      expect(antigravityCommand.getRelativeFilePath()).toBe("from-rulesync.md");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Default baseDir test",
      };
      const body = "Test workflow";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "default-base.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getBaseDir()).toBe(process.cwd());
    });

    it("should handle validation parameter", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Validation test",
      };
      const body = "Test workflow with validation";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const withValidation = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
        validate: true,
      });

      const withoutValidation = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
        validate: false,
      });

      expect(withValidation.getBody()).toBe(body);
      expect(withoutValidation.getBody()).toBe(body);
    });
  });

  describe("fromFile", () => {
    it("should create AntigravityCommand from file", async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      vi.spyOn(process, "cwd").mockReturnValue(testDir);

      try {
        const frontmatter: AntigravityCommandFrontmatter = {
          description: "Test workflow from file",
        };
        const body = "Workflow body from file";
        const fileContent = stringifyFrontmatter(body, frontmatter);

        const workflowsDir = join(testDir, ".agent/workflows");
        await writeFileContent(join(workflowsDir, "test-file.md"), fileContent);

        const command = await AntigravityCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "test-file.md",
        });

        expect(command.getBody()).toBe(body);
        expect(command.getFrontmatter()).toEqual(frontmatter);
        expect(command.getRelativeDirPath()).toBe(".agent/workflows");
        expect(command.getRelativeFilePath()).toBe("test-file.md");
      } finally {
        await cleanup();
        vi.restoreAllMocks();
      }
    });

    it("should throw error when file does not exist", async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        await expect(
          AntigravityCommand.fromFile({
            baseDir: testDir,
            relativeFilePath: "nonexistent.md",
          }),
        ).rejects.toThrow();
      } finally {
        await cleanup();
      }
    });

    it("should throw error when frontmatter is invalid", async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        const invalidContent = "---\ndescription: 123\n---\nBody content";
        const workflowsDir = join(testDir, ".agent/workflows");
        await writeFileContent(join(workflowsDir, "invalid.md"), invalidContent);

        await expect(
          AntigravityCommand.fromFile({
            baseDir: testDir,
            relativeFilePath: "invalid.md",
            validate: true,
          }),
        ).rejects.toThrow();
      } finally {
        await cleanup();
      }
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          description: "Test",
        },
        body: "Body",
        fileContent: "",
      });

      expect(AntigravityCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for antigravity target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["antigravity"],
          description: "Test",
        },
        body: "Body",
        fileContent: "",
      });

      expect(AntigravityCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false for other specific targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test",
        },
        body: "Body",
        fileContent: "",
      });

      expect(AntigravityCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct workflows path", () => {
      const paths = AntigravityCommand.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".agent/workflows");
    });
  });
});
