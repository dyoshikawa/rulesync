import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCommand } from "./kiro-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KiroCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validContent = "# Sample prompt\n\nFollow these steps.";

  const markdownWithFrontmatter = `---
title: Example
---

# Prompt
Step 1`;

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
      const paths = KiroCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "prompts") });
    });

    it("should use the same path in global mode", () => {
      const paths = KiroCommand.getSettablePaths({ global: true });

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "prompts") });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with default frontmatter", () => {
      const kiroCommand = new KiroCommand({
        baseDir: testDir,
        relativeDirPath: ".kiro/prompts",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      const rulesyncCommand = kiroCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({ targets: ["*"], description: "" });
      expect(rulesyncCommand.getBody()).toBe(validContent);
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create KiroCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["kiro"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      const kiroCommand = KiroCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(kiroCommand).toBeInstanceOf(KiroCommand);
      expect(kiroCommand.getRelativeDirPath()).toBe(join(".kiro", "prompts"));
      expect(kiroCommand.getFileContent()).toBe(validContent);
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const command = new KiroCommand({
        baseDir: testDir,
        relativeDirPath: ".kiro/prompts",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("fromFile", () => {
    it("should load and strip frontmatter", async () => {
      const promptsDir = join(testDir, ".kiro", "prompts");
      const filePath = join(promptsDir, "prompt.md");
      await writeFileContent(filePath, markdownWithFrontmatter);

      const command = await KiroCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "prompt.md",
      });

      expect(command).toBeInstanceOf(KiroCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kiro", "prompts"));
      expect(command.getFileContent()).toBe("# Prompt\nStep 1");
    });

    it("should support global prompts", async () => {
      const promptsDir = join(testDir, ".kiro", "prompts");
      const filePath = join(promptsDir, "global.md");
      await writeFileContent(filePath, validContent);

      const command = await KiroCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "global.md",
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".kiro", "prompts"));
      expect(command.getFileContent()).toBe(validContent);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when rulesync targets include kiro", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["kiro"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(KiroCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when kiro is not targeted", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["cursor"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(KiroCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable command placeholder", () => {
      const command = KiroCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kiro/prompts",
        relativeFilePath: "obsolete.md",
      });

      expect(command.isDeletable()).toBe(true);
      expect(command.getFileContent()).toBe("");
    });
  });
});
