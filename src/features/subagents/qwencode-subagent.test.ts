import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { QwencodeSubagent } from "./qwencode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

describe("QwencodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
name: Test Qwencode Agent
description: Test qwencode agent description
model: qwen-coder
approvalMode: auto
---

This is the body of the qwencode agent.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required fields
invalid: true
---

Body content`;

  const markdownWithoutFrontmatter = `This is just plain content without frontmatter.`;

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
    it("should return correct paths for qwencode subagents", () => {
      const paths = QwencodeSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".qwen", "agents"),
      });
    });

    it("should return same .qwen/agents path in global mode (resolved relative to home)", () => {
      // Per https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md
      // global subagents live at ~/.qwen/agents/*.md, which uses the same
      // relative directory as project mode resolved against the home dir.
      const paths = QwencodeSubagent.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".qwen", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Qwencode Agent",
          description: "Test qwencode agent description",
        },
        body: "This is the body of the qwencode agent.\nIt can be multiline.",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(QwencodeSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the qwencode agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Qwencode Agent",
        description: "Test qwencode agent description",
      });
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new QwencodeSubagent({
            outputRoot: testDir,
            relativeDirPath: ".qwen/agents",
            relativeFilePath: "invalid-agent.md",
            frontmatter: {
              // Missing required name field
            } as { name: string },
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
        },
        body: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(subagent.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with name and description", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Qwencode Agent",
          description: "Test qwencode agent",
        },
        body: "Test body",
        validate: true,
      });

      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Qwencode Agent",
        description: "Test qwencode agent",
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create QwencodeSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test Agent",
          description: "Test description from rulesync",
        },
        body: "Test agent content",
        validate: true,
      });

      const qwencodeSubagent = QwencodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        rulesyncSubagent,
        validate: true,
      }) as QwencodeSubagent;

      expect(qwencodeSubagent).toBeInstanceOf(QwencodeSubagent);
      expect(qwencodeSubagent.getBody()).toBe("Test agent content");
      expect(qwencodeSubagent.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description from rulesync",
      });
      expect(qwencodeSubagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(qwencodeSubagent.getRelativeDirPath()).toBe(".qwen/agents");
    });

    it("should emit Markdown with YAML frontmatter including qwencode-section fields", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "rich-agent.md",
        frontmatter: {
          targets: ["qwencode"],
          name: "Rich Agent",
          description: "Rich agent description",
          qwencode: {
            model: "qwen-coder",
            approvalMode: "auto",
            tools: ["read_file", "write_file"],
            disallowedTools: ["run_shell_command"],
            maxTurns: 5,
            color: "blue",
            mcpServers: ["my-server"],
          },
        },
        body: "Rich agent body",
        validate: true,
      });

      const qwencodeSubagent = QwencodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        rulesyncSubagent,
        validate: true,
      }) as QwencodeSubagent;

      const frontmatter = qwencodeSubagent.getFrontmatter();
      expect(frontmatter).toEqual({
        name: "Rich Agent",
        description: "Rich agent description",
        model: "qwen-coder",
        approvalMode: "auto",
        tools: ["read_file", "write_file"],
        disallowedTools: ["run_shell_command"],
        maxTurns: 5,
        color: "blue",
        mcpServers: ["my-server"],
      });

      const fileContent = qwencodeSubagent.getFileContent();
      expect(fileContent).toContain("name: Rich Agent");
      expect(fileContent).toContain("model: qwen-coder");
      expect(fileContent).toContain("approvalMode: auto");
      expect(fileContent).toContain("Rich agent body");
    });

    it("should handle empty name and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["qwencode"],
          name: "",
          description: "",
        },
        body: "Test content",
        validate: true,
      });

      const qwencodeSubagent = QwencodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        rulesyncSubagent,
        validate: true,
      }) as QwencodeSubagent;

      expect(qwencodeSubagent.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent and round-trip qwencode-section fields", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "test-agent.md",
        frontmatter: {
          name: "Test Agent",
          description: "Test description",
          model: "qwen-coder",
          approvalMode: "auto",
          tools: ["read_file"],
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Test Agent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test description");
      expect(rulesyncSubagent.getFrontmatter().qwencode).toEqual({
        model: "qwen-coder",
        approvalMode: "auto",
        tools: ["read_file"],
      });
      expect(rulesyncSubagent.getBody()).toBe("Test body");

      // round-trip back to QwencodeSubagent
      const roundTripped = QwencodeSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        rulesyncSubagent,
        validate: true,
      }) as QwencodeSubagent;

      expect(roundTripped.getFrontmatter()).toEqual({
        name: "Test Agent",
        description: "Test description",
        model: "qwen-coder",
        approvalMode: "auto",
        tools: ["read_file"],
      });
    });
  });

  describe("fromFile", () => {
    it("should load QwencodeSubagent from file", async () => {
      const subagentsDir = join(testDir, ".qwen", "agents");
      const filePath = join(subagentsDir, "test-file-agent.md");

      await writeFileContent(filePath, validMarkdownContent);

      const subagent = await QwencodeSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-file-agent.md",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(QwencodeSubagent);
      expect(subagent.getBody()).toBe(
        "This is the body of the qwencode agent.\nIt can be multiline.",
      );
      expect(subagent.getFrontmatter()).toEqual({
        name: "Test Qwencode Agent",
        description: "Test qwencode agent description",
        model: "qwen-coder",
        approvalMode: "auto",
      });
      expect(subagent.getRelativeFilePath()).toBe("test-file-agent.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QwencodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const subagentsDir = join(testDir, ".qwen", "agents");
      const filePath = join(subagentsDir, "invalid-agent.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        QwencodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-agent.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error for file without frontmatter", async () => {
      const subagentsDir = join(testDir, ".qwen", "agents");
      const filePath = join(subagentsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        QwencodeSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "valid-agent.md",
        frontmatter: {
          name: "Valid Agent",
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

  describe("inheritance", () => {
    it("should be an instance of ToolSubagent", () => {
      const subagent = new QwencodeSubagent({
        outputRoot: testDir,
        relativeDirPath: ".qwen/agents",
        relativeFilePath: "test.md",
        frontmatter: {
          name: "Test",
          description: "Test",
        },
        body: "Test",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(QwencodeSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true when targets includes qwencode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(QwencodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true when targets includes asterisk", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["*"],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: true,
      });

      expect(QwencodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false when targets array is empty", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: [],
          name: "Test Agent",
          description: "Test description",
        },
        body: "Test content",
        validate: false,
      });

      expect(QwencodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });

    it("should return false when targets does not include qwencode", () => {
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

      expect(QwencodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });
});
