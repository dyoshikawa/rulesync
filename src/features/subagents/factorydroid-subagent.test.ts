import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FactorydroidSubagent } from "./factorydroid-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagentFrontmatter } from "./simulated-subagent.js";
import type { ToolSubagent } from "./tool-subagent.js";

describe("FactorydroidSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Factorydroid Droid
description: Test factorydroid droid description
---

This is the body of the factorydroid droid.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required fields
invalid: true
---

Body content`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for factorydroid subagents", () => {
      const paths = FactorydroidSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".factory/droids",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new FactorydroidSubagent({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        relativeFilePath: "test-droid.md",
        frontmatter: {
          name: "Test Factorydroid Droid",
          description: "Test factorydroid droid description",
        },
        body: "This is the body of the factorydroid droid.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the factorydroid droid.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Factorydroid Droid",
        description: "Test factorydroid droid description",
      });
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new FactorydroidSubagent({
            baseDir: testDir,
            relativeDirPath: ".factory/droids",
            relativeFilePath: "invalid-droid.md",
            frontmatter: {
              // Missing required fields
            } as SimulatedSubagentFrontmatter,
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should throw error as it is a simulated file", () => {
      const subagent = new FactorydroidSubagent({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        relativeFilePath: "test-droid.md",
        frontmatter: {
          name: "Test Droid",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      expect(() => subagent.toRulesyncSubagent()).toThrow(
        "Not implemented because it is a SIMULATED file.",
      );
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create FactorydroidSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-droid.md",
        frontmatter: {
          targets: ["factorydroid"],
          name: "Test Droid",
          description: "Test description from rulesync",
        },
        body: "Test droid content",
        validate: true,
      });

      const factorydroidSubagent = FactorydroidSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        rulesyncSubagent,
        validate: true,
      }) as FactorydroidSubagent;

      expect(factorydroidSubagent).toBeInstanceOf(FactorydroidSubagent);
      expect(factorydroidSubagent.getBody()).toBe("Test droid content");
      expect(factorydroidSubagent.getFrontmatter()).toEqual({
        name: "Test Droid",
        description: "Test description from rulesync",
      });
      expect(factorydroidSubagent.getRelativeFilePath()).toBe("test-droid.md");
      expect(factorydroidSubagent.getRelativeDirPath()).toBe(".factory/droids");
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidSubagent from file", async () => {
      const droidsDir = join(testDir, ".factory", "droids");
      const filePath = join(droidsDir, "test-file-droid.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await FactorydroidSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-droid.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the factorydroid droid.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Factorydroid Droid",
        description: "Test factorydroid droid description",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-droid.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-droid.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const droidsDir = join(testDir, ".factory", "droids");
      const filePath = join(droidsDir, "invalid-droid.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        FactorydroidSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-droid.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new FactorydroidSubagent({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        relativeFilePath: "valid-droid.md",
        frontmatter: {
          name: "Valid Droid",
          description: "Valid description",
        },
        body: "Valid body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for rulesync subagent with wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return true for rulesync subagent with factorydroid target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["factorydroid"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(true);
    });

    it("should return false for rulesync subagent with different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      const result = FactorydroidSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent);
      expect(result).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const subagent = FactorydroidSubagent.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        relativeFilePath: "to-delete.md",
      });

      expect(subagent).toBeInstanceOf(FactorydroidSubagent);
      expect(subagent.getRelativeFilePath()).toBe("to-delete.md");
    });
  });

  describe("integration with base classes", () => {
    it("should be assignable to ToolSubagent type", () => {
      const subagent = new FactorydroidSubagent({
        baseDir: testDir,
        relativeDirPath: ".factory/droids",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        validate: false,
      });

      const toolSubagent: ToolSubagent = subagent;
      expect(toolSubagent).toBeDefined();
    });
  });
});
