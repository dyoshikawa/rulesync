import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiloCommand } from "./kilo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KiloCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validContent = "# Sample workflow\n\nFollow these steps.";

  const markdownWithFrontmatter = `---
title: Example
---

# Workflow
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
    it("should return workflow path for project mode", () => {
      const paths = KiloCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".kilocode", "workflows") });
    });

    it("should use the same path in global mode", () => {
      const paths = KiloCommand.getSettablePaths({ global: true });

      expect(paths).toEqual({ relativeDirPath: join(".kilocode", "workflows") });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with default frontmatter", () => {
      const kiloCommand = new KiloCommand({
        baseDir: testDir,
        relativeDirPath: ".kilocode/workflows",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      const rulesyncCommand = kiloCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({ targets: ["*"], description: "" });
      expect(rulesyncCommand.getBody()).toBe(validContent);
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create KiloCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["kilo"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      const kiloCommand = KiloCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(kiloCommand).toBeInstanceOf(KiloCommand);
      expect(kiloCommand.getRelativeDirPath()).toBe(join(".kilocode", "workflows"));
      expect(kiloCommand.getFileContent()).toBe(validContent);
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const command = new KiloCommand({
        baseDir: testDir,
        relativeDirPath: ".kilocode/workflows",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("fromFile", () => {
    it("should load and strip frontmatter", async () => {
      const workflowsDir = join(testDir, ".kilocode", "workflows");
      const filePath = join(workflowsDir, "workflow.md");
      await writeFileContent(filePath, markdownWithFrontmatter);

      const command = await KiloCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "workflow.md",
      });

      expect(command).toBeInstanceOf(KiloCommand);
      expect(command.getRelativeDirPath()).toBe(join(".kilocode", "workflows"));
      expect(command.getFileContent()).toBe("# Workflow\nStep 1");
    });

    it("should support global workflows", async () => {
      const workflowsDir = join(testDir, ".kilocode", "workflows");
      const filePath = join(workflowsDir, "global.md");
      await writeFileContent(filePath, validContent);

      const command = await KiloCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "global.md",
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".kilocode", "workflows"));
      expect(command.getFileContent()).toBe(validContent);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when rulesync targets include kilo", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["kilo"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(KiloCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when kilo is not targeted", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "workflow.md",
        frontmatter: { targets: ["cursor"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(KiloCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable command placeholder", () => {
      const command = KiloCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kilocode/workflows",
        relativeFilePath: "obsolete.md",
      });

      expect(command.isDeletable()).toBe(true);
      expect(command.getFileContent()).toBe("");
    });
  });
});
