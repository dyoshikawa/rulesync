import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand, type RulesyncCommandFrontmatter } from "./rulesync-command.js";

describe("RooCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("creates instance with valid frontmatter", () => {
      const frontmatter = {
        description: "Test command description",
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe("Test command body");
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("creates instance with optional argument-hint", () => {
      const frontmatter = {
        description: "Test command description",
        "argument-hint": "<file-or-directory>",
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe("Test command body");
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("throws error with invalid frontmatter", () => {
      const invalidFrontmatter = {
        // Missing required description
      };

      expect(
        () =>
          new RooCommand({
            baseDir: testDir,
            relativeDirPath: ".roo/commands",
            relativeFilePath: "test.md",
            frontmatter: invalidFrontmatter as any,
            body: "Test command body",
            fileContent: "",
          }),
      ).toThrow();
    });

    it("skips validation when validate is false", () => {
      const invalidFrontmatter = {
        // Missing required description
      };

      expect(
        () =>
          new RooCommand({
            baseDir: testDir,
            relativeDirPath: ".roo/commands",
            relativeFilePath: "test.md",
            frontmatter: invalidFrontmatter as any,
            body: "Test command body",
            fileContent: "",
            validate: false,
          }),
      ).not.toThrow();
    });
  });

  describe("toRulesyncCommand", () => {
    it("converts to RulesyncCommand", () => {
      const frontmatter = {
        description: "Test command description",
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test command body");

      const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
      expect(rulesyncFrontmatter.targets).toEqual(["roo"]);
      expect(rulesyncFrontmatter.description).toBe("Test command description");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("creates RooCommand from RulesyncCommand", () => {
      const rulesyncFrontmatter = {
        targets: ["roo"],
        description: "Test command description",
      } satisfies RulesyncCommandFrontmatter;

      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", rulesyncFrontmatter),
      });

      const rooCommand = RooCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        relativeDirPath: ".roo/commands",
      });

      expect(rooCommand).toBeInstanceOf(RooCommand);
      expect(rooCommand.getBody()).toBe("Test command body");

      const frontmatter = rooCommand.getFrontmatter() as any;
      expect(frontmatter.description).toBe("Test command description");
    });
  });

  describe("fromFilePath", () => {
    it("loads RooCommand from file", async () => {
      const frontmatter = {
        description: "Test command description",
      };
      const body = "Test command body";
      const fileContent = matter.stringify(body, frontmatter);

      const filePath = join(testDir, "test-command.md");
      await writeFile(filePath, fileContent, "utf-8");

      const command = await RooCommand.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test-command.md",
        filePath,
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe("Test command body");

      const loadedFrontmatter = command.getFrontmatter() as any;
      expect(loadedFrontmatter.description).toBe("Test command description");
    });

    it("loads command with argument-hint", async () => {
      const frontmatter = {
        description: "Analyze code for performance bottlenecks",
        "argument-hint": "<file-or-function>",
      };
      const body = "Analyze the specified code for performance issues";
      const fileContent = matter.stringify(body, frontmatter);

      const filePath = join(testDir, "analyze-performance.md");
      await writeFile(filePath, fileContent, "utf-8");

      const command = await RooCommand.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "analyze-performance.md",
        filePath,
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe("Analyze the specified code for performance issues");

      const loadedFrontmatter = command.getFrontmatter() as any;
      expect(loadedFrontmatter.description).toBe("Analyze code for performance bottlenecks");
      expect(loadedFrontmatter["argument-hint"]).toBe("<file-or-function>");
    });

    it("throws error for invalid frontmatter in file", async () => {
      const invalidFrontmatter = {
        // Missing required description
      };
      const body = "Test command body";
      const fileContent = matter.stringify(body, invalidFrontmatter);

      const filePath = join(testDir, "invalid-command.md");
      await writeFile(filePath, fileContent, "utf-8");

      await expect(
        RooCommand.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".roo/commands",
          relativeFilePath: "invalid-command.md",
          filePath,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("loads command from namespaced path", async () => {
      const frontmatter = {
        description: "Comprehensive security + performance code review",
        "argument-hint": "<file-or-directory>",
      };
      const body = "Please perform a thorough review of the selected target";
      const fileContent = matter.stringify(body, frontmatter);

      // Create nested directory structure for namespaced command
      const namespacedDir = join(testDir, "code-quality");
      await mkdir(namespacedDir, { recursive: true });

      const filePath = join(namespacedDir, "review.md");
      await writeFile(filePath, fileContent, "utf-8");

      const command = await RooCommand.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".roo/commands/code-quality",
        relativeFilePath: "review.md",
        filePath,
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe("Please perform a thorough review of the selected target");
      expect(command.getRelativeFilePath()).toBe("review.md");
    });
  });

  describe("validate", () => {
    it("returns success for valid frontmatter", () => {
      const frontmatter = {
        description: "Test command description",
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("returns success for valid frontmatter with optional fields", () => {
      const frontmatter = {
        description: "Test command description",
        "argument-hint": "<file-path>",
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("returns error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        // Missing required description
      };

      const command = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: invalidFrontmatter as any,
        body: "Test command body",
        fileContent: "",
        validate: false, // Skip validation during construction to test validate() method
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("round-trip conversion", () => {
    it("maintains data integrity through RooCommand -> RulesyncCommand -> RooCommand", () => {
      const originalFrontmatter = {
        description: "Test command description",
        "argument-hint": "<target-file>",
      };

      const originalCommand = new RooCommand({
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: originalFrontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", originalFrontmatter),
      });

      // Convert to RulesyncCommand
      const rulesyncCommand = originalCommand.toRulesyncCommand();

      // Convert back to RooCommand
      const roundTripCommand = RooCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        relativeDirPath: ".roo/commands",
      });

      // Verify data integrity
      expect(roundTripCommand.getBody()).toBe(originalCommand.getBody());

      const roundTripFrontmatter = roundTripCommand.getFrontmatter() as any;
      expect(roundTripFrontmatter.description).toBe(originalFrontmatter.description);
      // Note: argument-hint is not preserved in round-trip conversion because
      // RulesyncCommand doesn't support it, which is expected behavior
    });
  });
});
