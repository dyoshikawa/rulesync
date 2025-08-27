import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { RulesyncCommand, type RulesyncCommandFrontmatter } from "./rulesync-command.js";

describe("ClaudecodeCommand", () => {
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

      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("Test command body");
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("throws error with invalid frontmatter", () => {
      const invalidFrontmatter = {
        // Missing required description
      };

      expect(
        () =>
          new ClaudecodeCommand({
            baseDir: testDir,
            relativeDirPath: ".claude/commands",
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
          new ClaudecodeCommand({
            baseDir: testDir,
            relativeDirPath: ".claude/commands",
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

      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", frontmatter),
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test command body");

      const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
      expect(rulesyncFrontmatter.targets).toEqual(["claudecode"]);
      expect(rulesyncFrontmatter.description).toBe("Test command description");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("creates ClaudecodeCommand from RulesyncCommand", () => {
      const rulesyncFrontmatter = {
        targets: ["claudecode"],
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

      const claudecodeCommand = ClaudecodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        relativeDirPath: ".claude/commands",
      });

      expect(claudecodeCommand).toBeInstanceOf(ClaudecodeCommand);
      expect(claudecodeCommand.getBody()).toBe("Test command body");

      const frontmatter = claudecodeCommand.getFrontmatter() as any;
      expect(frontmatter.description).toBe("Test command description");
    });
  });

  describe("fromFilePath", () => {
    it("loads ClaudecodeCommand from file", async () => {
      const frontmatter = {
        description: "Test command description",
      };
      const body = "Test command body";
      const fileContent = matter.stringify(body, frontmatter);

      const filePath = join(testDir, "test-command.md");
      await writeFile(filePath, fileContent, "utf-8");

      const command = await ClaudecodeCommand.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test-command.md",
        filePath,
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("Test command body");

      const loadedFrontmatter = command.getFrontmatter() as any;
      expect(loadedFrontmatter.description).toBe("Test command description");
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
        ClaudecodeCommand.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".claude/commands",
          relativeFilePath: "invalid-command.md",
          filePath,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("loads command from namespaced path", async () => {
      const frontmatter = {
        description: "Git commit helper command",
      };
      const body = "Generate commit message from staged changes";
      const fileContent = matter.stringify(body, frontmatter);

      // Create nested directory structure for namespaced command
      const namespacedDir = join(testDir, "git");
      await mkdir(namespacedDir, { recursive: true });

      const filePath = join(namespacedDir, "commit.md");
      await writeFile(filePath, fileContent, "utf-8");

      const command = await ClaudecodeCommand.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".claude/commands/git",
        relativeFilePath: "commit.md",
        filePath,
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("Generate commit message from staged changes");
      expect(command.getRelativeFilePath()).toBe("commit.md");
    });
  });

  describe("validate", () => {
    it("returns success for valid frontmatter", () => {
      const frontmatter = {
        description: "Test command description",
      };

      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
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

      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
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
    it("maintains data integrity through ClaudecodeCommand -> RulesyncCommand -> ClaudecodeCommand", () => {
      const originalFrontmatter = {
        description: "Test command description",
      };

      const originalCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: originalFrontmatter,
        body: "Test command body",
        fileContent: matter.stringify("Test command body", originalFrontmatter),
      });

      // Convert to RulesyncCommand
      const rulesyncCommand = originalCommand.toRulesyncCommand();

      // Convert back to ClaudecodeCommand
      const roundTripCommand = ClaudecodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        relativeDirPath: ".claude/commands",
      });

      // Verify data integrity
      expect(roundTripCommand.getBody()).toBe(originalCommand.getBody());

      const roundTripFrontmatter = roundTripCommand.getFrontmatter() as any;
      expect(roundTripFrontmatter.description).toBe(originalFrontmatter.description);
    });
  });
});
