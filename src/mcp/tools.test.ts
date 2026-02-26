import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { rulesyncTool } from "./tools.js";

describe("rulesyncTool", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("handles rule lifecycle through a single tool", async () => {
    const relativePathFromCwd = ".rulesync/rules/sample-rule.md";

    const putResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "put",
      targetPathFromCwd: relativePathFromCwd,
      frontmatter: { description: "Sample" },
      body: "# Rule Body",
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.relativePathFromCwd).toBe(relativePathFromCwd);

    const getResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "get",
      targetPathFromCwd: relativePathFromCwd,
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.body).toContain("Rule Body");

    // Note: list operation does not require targetPathFromCwd - it lists all rules
    const listResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "list",
    });

    const listParsed = JSON.parse(listResult);
    expect(listParsed.rules).toHaveLength(1);
    expect(listParsed.rules[0].relativePathFromCwd).toBe(relativePathFromCwd);

    const deleteResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "delete",
      targetPathFromCwd: relativePathFromCwd,
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(relativePathFromCwd);
  });

  it("supports MCP content operations", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await ensureDir(rulesyncDir);

    const content = JSON.stringify({
      mcpServers: { sample: { type: "stdio", command: "sample" } },
    });

    const putResult = await rulesyncTool.execute({
      feature: "mcp",
      operation: "put",
      content,
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.content).toContain("sample");

    const getResult = await rulesyncTool.execute({
      feature: "mcp",
      operation: "get",
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.content).toContain("sample");

    const deleteResult = await rulesyncTool.execute({
      feature: "mcp",
      operation: "delete",
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(".rulesync/mcp.json");

    // Verify the file is deleted by checking get throws
    await expect(
      rulesyncTool.execute({
        feature: "mcp",
        operation: "get",
      }),
    ).rejects.toThrow();
  });

  it("handles ignore file lifecycle through a single tool", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await ensureDir(rulesyncDir);

    const content = "node_modules/\n.env\n*.log";

    const putResult = await rulesyncTool.execute({
      feature: "ignore",
      operation: "put",
      content,
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.relativePathFromCwd).toBe(".rulesync/.aiignore");
    expect(putParsed.content).toContain("node_modules/");

    const getResult = await rulesyncTool.execute({
      feature: "ignore",
      operation: "get",
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.content).toContain("node_modules/");
    expect(getParsed.content).toContain(".env");

    const deleteResult = await rulesyncTool.execute({
      feature: "ignore",
      operation: "delete",
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(".rulesync/.aiignore");

    // Verify the file is deleted by checking get throws
    await expect(
      rulesyncTool.execute({
        feature: "ignore",
        operation: "get",
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported feature operations", async () => {
    await expect(
      rulesyncTool.execute({
        feature: "mcp",
        operation: "list",
      }),
    ).rejects.toThrow(/supported operations/i);
  });

  it("validates skill payload through the unified tool", async () => {
    const skillDir = join(testDir, ".rulesync/skills/test-skill");
    await ensureDir(skillDir);
    await writeFileContent(join(skillDir, "helper.txt"), "helper content");

    const putResult = await rulesyncTool.execute({
      feature: "skill",
      operation: "put",
      targetPathFromCwd: ".rulesync/skills/test-skill",
      frontmatter: { name: "test-skill", description: "Skill description", targets: ["*"] },
      body: "Skill body",
      otherFiles: [{ name: "helper.txt", body: "helper content" }],
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.otherFiles).toHaveLength(1);

    const getResult = await rulesyncTool.execute({
      feature: "skill",
      operation: "get",
      targetPathFromCwd: ".rulesync/skills/test-skill",
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.frontmatter.name).toBe("test-skill");
    expect(getParsed.otherFiles[0].name).toBe("helper.txt");
  });

  it("handles command lifecycle through a single tool", async () => {
    const relativePathFromCwd = ".rulesync/commands/test-command.md";

    const putResult = await rulesyncTool.execute({
      feature: "command",
      operation: "put",
      targetPathFromCwd: relativePathFromCwd,
      frontmatter: { description: "Test command", targets: ["*"] },
      body: "# Command Body",
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.relativePathFromCwd).toBe(relativePathFromCwd);

    const getResult = await rulesyncTool.execute({
      feature: "command",
      operation: "get",
      targetPathFromCwd: relativePathFromCwd,
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.body).toContain("Command Body");
    expect(getParsed.frontmatter.description).toBe("Test command");

    const listResult = await rulesyncTool.execute({
      feature: "command",
      operation: "list",
    });

    const listParsed = JSON.parse(listResult);
    expect(listParsed.commands).toHaveLength(1);
    expect(listParsed.commands[0].relativePathFromCwd).toBe(relativePathFromCwd);

    const deleteResult = await rulesyncTool.execute({
      feature: "command",
      operation: "delete",
      targetPathFromCwd: relativePathFromCwd,
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(relativePathFromCwd);
  });

  it("handles subagent lifecycle through a single tool", async () => {
    const relativePathFromCwd = ".rulesync/subagents/test-subagent.md";

    const putResult = await rulesyncTool.execute({
      feature: "subagent",
      operation: "put",
      targetPathFromCwd: relativePathFromCwd,
      frontmatter: { name: "test-subagent", description: "Test subagent", targets: ["*"] },
      body: "# Subagent Body",
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.relativePathFromCwd).toBe(relativePathFromCwd);

    const getResult = await rulesyncTool.execute({
      feature: "subagent",
      operation: "get",
      targetPathFromCwd: relativePathFromCwd,
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.body).toContain("Subagent Body");
    expect(getParsed.frontmatter.name).toBe("test-subagent");

    const listResult = await rulesyncTool.execute({
      feature: "subagent",
      operation: "list",
    });

    const listParsed = JSON.parse(listResult);
    expect(listParsed.subagents).toHaveLength(1);
    expect(listParsed.subagents[0].relativePathFromCwd).toBe(relativePathFromCwd);

    const deleteResult = await rulesyncTool.execute({
      feature: "subagent",
      operation: "delete",
      targetPathFromCwd: relativePathFromCwd,
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(relativePathFromCwd);
  });

  describe("path traversal protection", () => {
    it("should reject path traversal attempts for rule get", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "rule",
          operation: "get",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for rule put", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "rule",
          operation: "put",
          targetPathFromCwd: "../../../etc/passwd",
          frontmatter: { root: true },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for rule delete", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "rule",
          operation: "delete",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for command get", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "command",
          operation: "get",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for command put", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "command",
          operation: "put",
          targetPathFromCwd: "../../../etc/passwd",
          frontmatter: { targets: ["*"], description: "malicious" },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for command delete", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "command",
          operation: "delete",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for subagent get", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "subagent",
          operation: "get",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for subagent put", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "subagent",
          operation: "put",
          targetPathFromCwd: "../../../etc/passwd",
          frontmatter: { name: "malicious", targets: ["*"], description: "malicious" },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for subagent delete", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "subagent",
          operation: "delete",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for skill get", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "skill",
          operation: "get",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for skill put", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "skill",
          operation: "put",
          targetPathFromCwd: "../../../etc/passwd",
          frontmatter: { name: "malicious", targets: ["*"], description: "malicious" },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts for skill delete", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "skill",
          operation: "delete",
          targetPathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject path traversal attempts in skill otherFiles", async () => {
      const skillsDir = join(testDir, ".rulesync/skills");
      await ensureDir(skillsDir);

      await expect(
        rulesyncTool.execute({
          feature: "skill",
          operation: "put",
          targetPathFromCwd: ".rulesync/skills/test-skill",
          frontmatter: { name: "test-skill", targets: ["*"], description: "test" },
          body: "test body",
          otherFiles: [{ name: "../../../etc/passwd", body: "malicious content" }],
        }),
      ).rejects.toThrow(/path traversal/i);
    });
  });

  describe("import feature", () => {
    it("should execute import with run operation", async () => {
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await rulesyncTool.execute({
        feature: "import",
        operation: "run",
        importOptions: {
          target: "claudecode",
          features: ["rules"],
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBeDefined();
      expect(parsed.config).toBeDefined();
      expect(parsed.config.target).toBe("claudecode");
    });

    it("should return error when importOptions is not provided", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "import",
          operation: "run",
        }),
      ).rejects.toThrow("importOptions is required for import feature");
    });

    it("should return error when target is empty", async () => {
      const result = await rulesyncTool.execute({
        feature: "import",
        operation: "run",
        importOptions: {
          target: "",
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("target is required");
    });

    it("should reject unsupported operations for import feature", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "import",
          operation: "list",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "import",
          operation: "get",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "import",
          operation: "put",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "import",
          operation: "delete",
        }),
      ).rejects.toThrow(/supported operations/i);
    });
  });

  describe("generate feature", () => {
    it("should execute generate with run operation", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await rulesyncTool.execute({
        feature: "generate",
        operation: "run",
        generateOptions: {
          targets: ["agentsmd"],
          features: ["rules"],
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBeDefined();
      expect(parsed.config).toBeDefined();
    });

    it("should execute generate with default options", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await rulesyncTool.execute({
        feature: "generate",
        operation: "run",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("should return error when .rulesync directory does not exist", async () => {
      const result = await rulesyncTool.execute({
        feature: "generate",
        operation: "run",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain(".rulesync directory does not exist");
    });

    it("should reject unsupported operations for generate feature", async () => {
      await expect(
        rulesyncTool.execute({
          feature: "generate",
          operation: "list",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "generate",
          operation: "get",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "generate",
          operation: "put",
        }),
      ).rejects.toThrow(/supported operations/i);

      await expect(
        rulesyncTool.execute({
          feature: "generate",
          operation: "delete",
        }),
      ).rejects.toThrow(/supported operations/i);
    });
  });
});
