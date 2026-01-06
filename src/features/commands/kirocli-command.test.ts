import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCliCommand } from "./kirocli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KiroCliCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validFrontmatter = { description: "Test command" };
  const validBody = "# Sample prompt\n\nFollow these steps.";

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return prompts path for project mode", () => {
      const paths = KiroCliCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "prompts") });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const command = new KiroCliCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: validFrontmatter,
        body: validBody,
        validate: true,
      });

      expect(command).toBeInstanceOf(KiroCliCommand);
      expect(command.getFrontmatter()).toEqual(validFrontmatter);
      expect(command.getBody()).toBe(validBody);
    });

    it("should throw error for invalid frontmatter when validate is true", () => {
      expect(() => {
        new KiroCliCommand({
          baseDir: testDir,
          relativeDirPath: join(".kiro", "prompts"),
          relativeFilePath: "test.md",
          frontmatter: {} as { description: string },
          body: validBody,
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new KiroCliCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: validFrontmatter,
        body: validBody,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["kirocli"]);
      expect(rulesyncCommand.getFrontmatter().description).toBe("Test command");
      expect(rulesyncCommand.getBody()).toBe(validBody);
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create KiroCliCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["kirocli"], description: "Test prompt" },
        body: validBody,
        fileContent: validBody,
        validate: true,
      });

      const command = KiroCliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(KiroCliCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kiro", "prompts"));
      expect(command.getFrontmatter()).toEqual({ description: "Test prompt" });
      expect(command.getBody()).toBe(validBody);
    });
  });

  describe("validate", () => {
    it("should succeed for valid frontmatter", () => {
      const command = new KiroCliCommand({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: validFrontmatter,
        body: validBody,
        validate: false,
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("fromFile", () => {
    it("should load command from file", async () => {
      const promptsDir = join(testDir, ".kiro", "prompts");
      const filePath = join(promptsDir, "prompt.md");
      const content = `---
description: File prompt
---

# Prompt
Step 1`;
      await writeFileContent(filePath, content);

      const command = await KiroCliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "prompt.md",
      });

      expect(command).toBeInstanceOf(KiroCliCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kiro", "prompts"));
      expect(command.getFrontmatter()).toEqual({ description: "File prompt" });
      expect(command.getBody()).toBe("# Prompt\nStep 1");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when rulesync targets include kirocli", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["kirocli"], description: "" },
        body: validBody,
        fileContent: validBody,
        validate: true,
      });

      expect(KiroCliCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["*"], description: "" },
        body: validBody,
        fileContent: validBody,
        validate: true,
      });

      expect(KiroCliCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when kirocli is not targeted", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["cursor"], description: "" },
        body: validBody,
        fileContent: validBody,
        validate: true,
      });

      expect(KiroCliCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable command placeholder", () => {
      const command = KiroCliCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "prompts"),
        relativeFilePath: "obsolete.md",
      });

      expect(command.isDeletable()).toBe(true);
    });
  });
});
