import { describe, expect, it } from "vitest";
import type { ParsedCommand } from "../../types/commands.js";
import { ClaudeCodeCommandGenerator } from "./claudecode.js";

describe("ClaudeCodeCommandGenerator", () => {
  const generator = new ClaudeCodeCommandGenerator();

  describe("generate", () => {
    it("should generate a command file with frontmatter", () => {
      const command: ParsedCommand = {
        frontmatter: {
          description: "Test command description",
        },
        content: "This is the command content",
        filename: "test-command",
        filepath: "/path/to/test-command.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.tool).toBe("claudecode");
      expect(result.filepath).toBe("/output/.claude/commands/test-command.md");
      expect(result.content).toContain("---");
      expect(result.content).toContain("description: Test command description");
      expect(result.content).toContain("This is the command content");
    });

    it("should generate a command file without description", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Command without description",
        filename: "no-desc",
        filepath: "/path/to/no-desc.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toBe("---\n---\n\nCommand without description\n");
    });

    it("should flatten subdirectory names", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Test",
        filename: "git/commit",
        filepath: "/path/to/git/commit.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.filepath).toBe("/output/.claude/commands/git-commit.md");
    });
  });

  describe("getOutputPath", () => {
    it("should return the correct output path", () => {
      const path = generator.getOutputPath("test-command", "/base");
      expect(path).toBe("/base/.claude/commands/test-command.md");
    });

    it("should flatten nested paths", () => {
      const path = generator.getOutputPath("deep/nested/command", "/base");
      expect(path).toBe("/base/.claude/commands/deep-nested-command.md");
    });
  });
});