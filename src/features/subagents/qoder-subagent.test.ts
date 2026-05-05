import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { QoderSubagent } from "./qoder-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("QoderSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

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
    it("should return correct paths for qoder subagents", () => {
      const paths = QoderSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".qoder", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const frontmatter = {
        name: "Test Agent",
        description: "Test agent description",
      };
      const body = "This is the body of the qoder agent.";
      const subagent = new QoderSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qoder/agents",
        relativeFilePath: "test-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      expect(subagent).toBeInstanceOf(QoderSubagent);
      expect(subagent.getBody()).toBe("This is the body of the qoder agent.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test agent description",
      });
    });
  });

  describe("fromFile", () => {
    it("should create instance from valid file", async () => {
      const agentsDir = join(testDir, ".qoder", "agents");
      await ensureDir(agentsDir);
      const content = `---
name: File Agent
description: Agent loaded from file
---

This is the agent body from file.`;
      await writeFileContent(join(agentsDir, "file-agent.md"), content);

      const subagent = await QoderSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "file-agent.md",
      });

      expect(subagent).toBeInstanceOf(QoderSubagent);
      expect(subagent.getBody()).toBe("This is the agent body from file.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "File Agent",
        description: "Agent loaded from file",
      });
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QoderSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw error for invalid frontmatter", async () => {
      const agentsDir = join(testDir, ".qoder", "agents");
      await ensureDir(agentsDir);
      const content = `---
invalid: true
---

Body content`;
      await writeFileContent(join(agentsDir, "invalid-agent.md"), content);

      await expect(
        QoderSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-agent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent", () => {
      const frontmatter = {
        name: "Converter Agent",
        description: "Agent to convert",
      };
      const body = "Test agent body for conversion";
      const subagent = new QoderSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qoder/agents",
        relativeFilePath: "convert-agent.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("convert-agent.md");
      expect(rulesyncSubagent.getBody()).toBe("Test agent body for conversion");
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Converter Agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Agent to convert");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create QoderSubagent from RulesyncSubagent", () => {
      const rulesyncFrontmatter = {
        targets: ["*"] as ("*")[],
        name: "Rulesync Agent",
        description: "From rulesync",
      };
      const body = "Rulesync subagent body";
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        frontmatter: rulesyncFrontmatter,
        body,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        validate: true,
      });

      const subagent = QoderSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".qoder", "agents"),
        rulesyncSubagent,
      });

      expect(subagent).toBeInstanceOf(QoderSubagent);
      expect((subagent as QoderSubagent).getBody()).toBe("Rulesync subagent body");
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for subagents targeting qoder", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        frontmatter: { targets: ["qoder"], name: "Test", description: "Test" },
        body: "Test",
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        validate: false,
      });

      expect(QoderSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for subagents targeting all (*)", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Test",
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        validate: false,
      });

      expect(QoderSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for subagents not targeting qoder", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Test",
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        validate: false,
      });

      expect(QoderSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return successful validation for valid frontmatter", () => {
      const subagent = new QoderSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qoder/agents",
        relativeFilePath: "test.md",
        frontmatter: { name: "Valid Agent", description: "Valid" },
        body: "Test body",
        fileContent: "",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create an instance for deletion", () => {
      const subagent = QoderSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".qoder/agents",
        relativeFilePath: "to-delete.md",
      });

      expect(subagent).toBeInstanceOf(QoderSubagent);
    });
  });
});
