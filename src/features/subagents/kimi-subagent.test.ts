import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KimiSubagent } from "./kimi-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("KimiSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Kimi Agent
description: Test kimi agent description
model: kimi-k2
color: blue
---

This is the body of the kimi agent.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required fields
invalid: true
---

Body content`;

  const markdownWithoutFrontmatter = `This is just plain content without frontmatter.`;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return the project .kimi-code/agents path", () => {
      expect(KimiSubagent.getSettablePaths()).toEqual({
        relativeDirPath: join(".kimi-code", "agents"),
      });
    });

    it("should return the global .agents/agents path", () => {
      expect(KimiSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".agents", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const subagent = new KimiSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Kimi Agent",
          description: "Test kimi agent description",
        },
        body: "This is the body.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(KimiSubagent);
      expect(subagent.getBody()).toBe("This is the body.\nIt can be multiline.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Kimi Agent",
        description: "Test kimi agent description",
      });
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new KimiSubagent({
            outputRoot: testDir,
            relativeDirPath: join(".kimi-code", "agents"),
            relativeFilePath: "invalid-agent.md",
            frontmatter: {} as { name: string },
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create KimiSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["kimi"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const kimiSubagent = KimiSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as KimiSubagent;

      expect(kimiSubagent).toBeInstanceOf(KimiSubagent);
      expect(kimiSubagent.getBody()).toBe("Test agent content");
      expect(kimiSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(kimiSubagent.getRelativeDirPath()).toBe(join(".kimi-code", "agents"));
    });

    it("should emit Markdown with YAML frontmatter including kimi-section fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rich-agent.md",
        frontmatter: {
          targets: ["kimi"],
          name: "Rich Agent",
          description: "Rich agent description",
          kimi: {
            model: "kimi-k2",
            tools: ["read_file", "write_file"],
            color: "blue",
          },
        },
        body: "Rich agent body",
        validate: true,
      });

      const kimiSubagent = KimiSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as KimiSubagent;

      expect(kimiSubagent.getFrontmatter()).toEqual({
        name: "Rich Agent",
        description: "Rich agent description",
        model: "kimi-k2",
        tools: ["read_file", "write_file"],
        color: "blue",
      });

      const fileContent = kimiSubagent.getFileContent();
      expect(fileContent).toContain("name: Rich Agent");
      expect(fileContent).toContain("model: kimi-k2");
      expect(fileContent).toContain("Rich agent body");
    });

    it("should write into the global .agents/agents dir in global mode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-agent.md",
        frontmatter: { targets: ["kimi"], name: "Global Agent", description: "Global" },
        body: "Global body",
        validate: true,
      });

      const kimiSubagent = KimiSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        rulesyncSubagent,
        validate: true,
        global: true,
      }) as KimiSubagent;

      expect(kimiSubagent.getRelativeDirPath()).toBe(join(".agents", "agents"));
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and round-trip kimi-section fields", () => {
      const subagent = new KimiSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
          model: "kimi-k2",
          tools: ["read_file"],
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Test Agent");
      expect(rulesyncSubagent.getFrontmatter().kimi).toEqual({
        model: "kimi-k2",
        tools: ["read_file"],
      });

      const roundTripped = KimiSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        rulesyncSubagent,
        validate: true,
      }) as KimiSubagent;

      expect(roundTripped.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description",
        model: "kimi-k2",
        tools: ["read_file"],
      });
    });
  });

  describe("fromFile", () => {
    it("should load KimiSubagent from file", async () => {
      const filePath = join(testDir, ".kimi-code", "agents", "test-file-agent.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await KimiSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(KimiSubagent);
      expect(subagent.getBody()).toBe("This is the body of the kimi agent.\nIt can be multiline.");
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Kimi Agent",
        description: "Test kimi agent description",
        model: "kimi-k2",
        color: "blue",
      });
    });

    it("should load KimiSubagent from the global dir in global mode", async () => {
      const filePath = join(testDir, ".agents", "agents", "global-file-agent.md");
      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await KimiSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global-file-agent.md",
        validate: true,
        global: true,
      });

      expect(subagent.getRelativeDirPath()).toBe(join(".agents", "agents"));
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        KimiSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const filePath = join(testDir, ".kimi-code", "agents", "invalid-agent.md");
      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        KimiSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error for file without frontmatter", async () => {
      const filePath = join(testDir, ".kimi-code", "agents", "no-frontmatter.md");
      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        KimiSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new KimiSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        relativeFilePath: "valid-agent.md",
        frontmatter: { name: "Valid Agent", description: "Valid description" },
        body: "Valid body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new KimiSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        relativeFilePath: "test.md",
        frontmatter: { name: "Test", description: "Test" },
        body: "Test",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(KimiSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true when targets includes kimi", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets: ["kimi"], name: "Test Agent", description: "Test description" },
        body: "Test content",
        validate: true,
      });

      expect(KimiSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: { targets: ["*"], name: "Test Agent", description: "Test description" },
        body: "Test content",
        validate: true,
      });

      expect(KimiSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false when targets does not include kimi", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["copilot", "cline"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(KimiSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal deletable instance", () => {
      const subagent = KimiSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "agents"),
        relativeFilePath: "to-delete.md",
      });

      expect(subagent).toBeInstanceOf(KimiSubagent);
      expect(subagent.getRelativeFilePath()).toBe("to-delete.md");
    });
  });
});
