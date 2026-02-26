import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ClineCommand } from "./cline-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("ClineCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  const validContent = "# Sample workflow\n\nDo something helpful.";

  const markdownWithFrontmatter = `---
title: Test workflow
---

# Workflow
Step 1`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = testDir;
    process.env.USERPROFILE = testDir;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return project paths for cline workflows", () => {
      const paths = ClineCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".clinerules", "workflows") });
    });

    it("should return global workflow path when global is true", () => {
      const paths = ClineCommand.getSettablePaths({ global: true });

      expect(paths).toEqual({
        relativeDirPath: join("Documents", "Cline", "Workflows"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const command = new ClineCommand({
        baseDir: testDir,
        relativeDirPath: ".clinerules/workflows",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      expect(command).toBeInstanceOf(ClineCommand);
      expect(command.getFileContent()).toBe(validContent);
    });

    it("should allow empty content", () => {
      const command = new ClineCommand({
        baseDir: testDir,
        relativeDirPath: ".clinerules/workflows",
        relativeFilePath: "test.md",
        fileContent: "",
        validate: true,
      });

      expect(command.getFileContent()).toBe("");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const clineCommand = new ClineCommand({
        baseDir: testDir,
        relativeDirPath: ".clinerules/workflows",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      const rulesyncCommand = clineCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncCommand.getBody()).toBe(validContent);
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create ClineCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["cline"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      const clineCommand = ClineCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(clineCommand).toBeInstanceOf(ClineCommand);
      expect(clineCommand.getRelativeDirPath()).toBe(join(".clinerules", "workflows"));
      expect(clineCommand.getFileContent()).toBe(validContent);
    });
  });

  describe("validate", () => {
    it("should always pass validation", () => {
      const command = new ClineCommand({
        baseDir: testDir,
        relativeDirPath: ".clinerules/workflows",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      expect(command.validate().success).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should load and strip frontmatter content", async () => {
      const workflowsDir = join(testDir, ".clinerules", "workflows");
      const filePath = join(workflowsDir, "workflow.md");
      await writeFileContent(filePath, markdownWithFrontmatter);

      const command = await ClineCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "workflow.md",
      });

      expect(command).toBeInstanceOf(ClineCommand);
      expect(command.getRelativeDirPath()).toBe(join(".clinerules", "workflows"));
      expect(command.getFileContent()).toBe("# Workflow\nStep 1");
    });

    it("should load global workflows when global is true", async () => {
      const globalDir = join("Documents", "Cline", "Workflows");
      const absoluteGlobalDir = join(testDir, globalDir);
      const filePath = join(absoluteGlobalDir, "global.md");
      await writeFileContent(filePath, validContent);

      const command = await ClineCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "global.md",
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(globalDir);
      expect(command.getFileContent()).toBe(validContent);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when targets include cline", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["cline"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(ClineCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when targets exclude cline", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["cursor"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(ClineCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable command", () => {
      const command = ClineCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".clinerules/workflows",
        relativeFilePath: "obsolete.md",
      });

      expect(command.isDeletable()).toBe(true);
      expect(command.getFileContent()).toBe("");
    });
  });
});
