import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AntigravityCommand, AntigravityCommandFrontmatter } from "./antigravity-command.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";

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

    it("should preserve trigger and turbo fields in antigravity section", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Workflow with trigger and turbo",
        trigger: "/my-workflow",
        turbo: true,
      };
      const body = "# Workflow: /my-workflow\n\nWorkflow content\n\n// turbo";

      const antigravityCommand = new AntigravityCommand({
        baseDir: "/test/base",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "my-workflow.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = antigravityCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["antigravity"],
        description: frontmatter.description,
        antigravity: {
          trigger: "/my-workflow",
          turbo: true,
        },
      });
    });

    it("should not include antigravity section when no extra fields exist", () => {
      const frontmatter: AntigravityCommandFrontmatter = {
        description: "Simple workflow without extra fields",
      };
      const body = "Simple workflow content";

      const antigravityCommand = new AntigravityCommand({
        baseDir: "/test/base",
        relativeDirPath: ".agent/workflows",
        relativeFilePath: "simple.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = antigravityCommand.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["antigravity"],
        description: frontmatter.description,
      });
      expect(rulesyncCommand.getFrontmatter()).not.toHaveProperty("antigravity");
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
      expect(antigravityCommand.getBody()).toContain(body);
      expect(antigravityCommand.getBody()).toContain("# Workflow:");

      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: rulesyncFrontmatter.description,
        trigger: "/from-rulesync",
        turbo: true,
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
        description: 123, // Invalid: should be string
      };
      const body = "Test workflow with validation";

      // Testing runtime validation: force invalid type through TS
      const invalidCommandParams = {
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: rulesyncFrontmatter as unknown as RulesyncCommandFrontmatter,
        body,
        fileContent: stringifyFrontmatter(
          body,
          rulesyncFrontmatter as unknown as RulesyncCommandFrontmatter,
        ),
      };

      const rulesyncCommand = new RulesyncCommand(invalidCommandParams);

      // Should fail when validate is true (default)
      expect(() => {
        AntigravityCommand.fromRulesyncCommand({
          rulesyncCommand,
          validate: true,
        });
      }).toThrow();

      const withoutValidation = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
        validate: false,
      });

      expect(withoutValidation.getBody()).toContain(body);
      // Should succeed when validate is false
      expect(() => {
        AntigravityCommand.fromRulesyncCommand({
          rulesyncCommand,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should transform RulesyncCommand into Workflow when trigger is present", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Test Workflow",
        antigravity: {
          trigger: "/test-workflow",
          turbo: true,
        },
      };
      const body = "Step 1: Do something";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "original-file.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      // 1. Check filename renaming (based on trigger)
      expect(antigravityCommand.getRelativeFilePath()).toBe("test-workflow.md");

      // 2. Check content wrapping
      const content = antigravityCommand.getBody();
      expect(content).toContain("# Workflow: /test-workflow");
      expect(content).toContain("Step 1: Do something");

      // 3. Check Turbo mode
      expect(content).toContain("// turbo");

      // 4. Verify Frontmatter description
      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "Test Workflow",
        trigger: "/test-workflow",
        turbo: true,
      });
    });

    it("should support root level trigger as fallback", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Root Trigger Workflow",
        trigger: "/root-trigger",
      };
      const body = "Simple body";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "root.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(antigravityCommand.getRelativeFilePath()).toBe("root-trigger.md");
      expect(antigravityCommand.getBody()).toContain("# Workflow: /root-trigger");
    });

    it("should use filename as default trigger if none provided", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Standard Command",
      };
      const body = "Just a command";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "standard.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      // Should use filename as trigger name (standard.md -> /standard)
      expect(antigravityCommand.getRelativeFilePath()).toBe("standard.md");

      // Should HAVE workflow header with default trigger
      expect(antigravityCommand.getBody()).toContain("# Workflow: /standard");
      expect(antigravityCommand.getBody()).toContain("// turbo"); // Default is true

      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "Standard Command",
        trigger: "/standard",
        turbo: true,
      });
    });

    it("should omit turbo directive when turbo is explicitly false", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "No Turbo Workflow",
        antigravity: {
          trigger: "/no-turbo",
          turbo: false,
        },
      };
      const body = "Workflow without auto-execution";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "no-turbo.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      // Should have workflow header
      expect(antigravityCommand.getBody()).toContain("# Workflow: /no-turbo");
      expect(antigravityCommand.getBody()).toContain("Workflow without auto-execution");

      // Should NOT contain turbo directive
      expect(antigravityCommand.getBody()).not.toContain("// turbo");

      expect(antigravityCommand.getFrontmatter()).toEqual({
        description: "No Turbo Workflow",
        trigger: "/no-turbo",
        turbo: false,
      });
    });

    it("should strip existing frontmatter from body if present (Double Frontmatter Fix)", () => {
      const dirtyBody = `---
description: Old Description
targets: ["*"]
---
Actual command content`;

      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "New Description",
        antigravity: {
          trigger: "/clean-workflow",
        },
      };

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "dirty.md",
        frontmatter: rulesyncFrontmatter,
        body: dirtyBody,
        fileContent: stringifyFrontmatter(dirtyBody, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      const body = antigravityCommand.getBody();

      // Should NOT contain the old frontmatter delimiters
      expect(body).not.toContain("description: Old Description");
      expect(body).not.toContain("---");

      expect(body).toContain("# Workflow: /clean-workflow");
      expect(body).toContain("Actual command content");
    });

    it("should strip frontmatter with Windows line endings (CRLF)", () => {
      const dirtyBody = "---\r\ndescription: Old\r\n---\r\nActual content";

      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "CRLF Test",
        antigravity: { trigger: "/crlf-test" },
      };

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "crlf.md",
        frontmatter: rulesyncFrontmatter,
        body: dirtyBody,
        fileContent: stringifyFrontmatter(dirtyBody, rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({ rulesyncCommand });
      const body = antigravityCommand.getBody();

      expect(body).not.toContain("description: Old");
      expect(body).toContain("Actual content");
    });

    it("should sanitize trigger to prevent path traversal", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Security Test",
        antigravity: {
          trigger: "/../evil-workflow", // Potentially malicious trigger
        },
      };

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "evil.md",
        frontmatter: rulesyncFrontmatter,
        body: "Malicious payload",
        fileContent: stringifyFrontmatter("Malicious payload", rulesyncFrontmatter),
      });

      const antigravityCommand = AntigravityCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      // Should be sanitized to safe characters only
      // /../evil-workflow -> -evil-workflow
      expect(antigravityCommand.getRelativeFilePath()).not.toContain("..");
      expect(antigravityCommand.getRelativeFilePath()).not.toContain("/");
      expect(antigravityCommand.getRelativeFilePath()).toMatch(/^[a-zA-Z0-9-_]+\.md$/);
    });

    it("should throw error when sanitization results in empty string", () => {
      const rulesyncFrontmatter = {
        targets: ["antigravity" as const],
        description: "Empty Trigger Test",
        antigravity: {
          trigger: "/../../../", // All characters will be sanitized away
        },
      };

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "empty.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
        fileContent: stringifyFrontmatter("Test body", rulesyncFrontmatter),
      });

      expect(() => {
        AntigravityCommand.fromRulesyncCommand({ rulesyncCommand });
      }).toThrow(/sanitization resulted in empty string/);
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
