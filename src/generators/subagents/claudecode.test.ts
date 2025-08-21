import { describe, expect, it } from "vitest";
import type { ParsedSubagent } from "../../types/subagents.js";
import { ClaudeCodeSubagentGenerator } from "./claudecode.js";

describe("ClaudeCodeSubagentGenerator", () => {
  const generator = new ClaudeCodeSubagentGenerator();

  describe("getToolName", () => {
    it("should return claudecode", () => {
      expect(generator.getToolName()).toBe("claudecode");
    });
  });

  describe("getSubagentsDirectory", () => {
    it("should return .claude/agents", () => {
      expect(generator.getSubagentsDirectory()).toBe(".claude/agents");
    });
  });

  describe("processContent", () => {
    it("should generate YAML content with description", () => {
      const subagent: ParsedSubagent = {
        frontmatter: {
          description: "Test subagent for code review",
        },
        content: "You are a code review specialist. Please review code for best practices.",
        filename: "code-reviewer",
        filepath: "/test/code-reviewer.md",
      };

      const result = generator.processContent(subagent);

      expect(result).toContain('description: "Test subagent for code review"');
      expect(result).toContain(
        "You are a code review specialist. Please review code for best practices.",
      );
      expect(result).toMatch(/^---\n.*\n---\n\n/);
    });

    it("should generate YAML content without description", () => {
      const subagent: ParsedSubagent = {
        frontmatter: {},
        content: "You are a helpful AI assistant.",
        filename: "helper",
        filepath: "/test/helper.md",
      };

      const result = generator.processContent(subagent);

      expect(result).not.toContain("description:");
      expect(result).toContain("You are a helpful AI assistant.");
      expect(result).toMatch(/^---\n---\n\n/);
    });
  });

  describe("generate", () => {
    it("should generate correct output", () => {
      const subagent: ParsedSubagent = {
        frontmatter: {
          description: "Security auditor",
        },
        content: "You are a security expert. Analyze code for vulnerabilities.",
        filename: "security-auditor",
        filepath: "/test/security-auditor.md",
      };

      const result = generator.generate(subagent, "/tmp");

      expect(result.tool).toBe("claudecode");
      expect(result.filepath).toBe("/tmp/.claude/agents/security-auditor.yaml");
      expect(result.content).toContain('description: "Security auditor"');
      expect(result.content).toContain(
        "You are a security expert. Analyze code for vulnerabilities.",
      );
    });
  });
});
