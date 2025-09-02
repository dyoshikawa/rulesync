import { describe, expect, it } from "vitest";
import { CommandFrontmatterSchema, type CommandOutput, type ParsedCommand } from "./commands.js";

describe("commands types", () => {
  describe("CommandFrontmatterSchema", () => {
    it("should validate empty frontmatter", () => {
      const result = CommandFrontmatterSchema.parse({});
      expect(result).toEqual({});
    });

    it("should validate frontmatter with description", () => {
      const frontmatter = { description: "Test command description" };
      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual(frontmatter);
    });

    it("should validate frontmatter with undefined description", () => {
      const frontmatter = { description: undefined };
      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual({ description: undefined });
    });

    it("should allow additional properties", () => {
      const frontmatter = {
        description: "Test description",
        customField: "custom value",
        anotherField: 42,
      };

      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe("Test description");
    });

    it("should reject non-string descriptions", () => {
      const invalidFrontmatters = [
        { description: 123 },
        { description: null },
        { description: [] },
        { description: {} },
      ];

      for (const frontmatter of invalidFrontmatters) {
        expect(() => CommandFrontmatterSchema.parse(frontmatter)).toThrow();
      }
    });
  });

  describe("type definitions", () => {
    it("should support ParsedCommand type", () => {
      const parsedCommand: ParsedCommand = {
        frontmatter: { description: "Test command" },
        content: "Command content",
        filename: "test-command.md",
        filepath: "./commands/test-command.md",
        type: "command",
      };

      expect(parsedCommand.frontmatter.description).toBe("Test command");
      expect(parsedCommand.content).toBe("Command content");
      expect(parsedCommand.filename).toBe("test-command.md");
      expect(parsedCommand.filepath).toBe("./commands/test-command.md");
      expect(parsedCommand.type).toBe("command");
    });

    it("should support ParsedCommand without type", () => {
      const parsedCommand: ParsedCommand = {
        frontmatter: { description: "Test without type" },
        content: "Content",
        filename: "test.md",
        filepath: "./test.md",
      };

      expect(parsedCommand.type).toBeUndefined();
      expect(parsedCommand.frontmatter.description).toBe("Test without type");
    });

    it("should support ParsedCommand with rule type", () => {
      const parsedCommand: ParsedCommand = {
        frontmatter: {},
        content: "Rule content",
        filename: "rule.md",
        filepath: "./rule.md",
        type: "rule",
      };

      expect(parsedCommand.type).toBe("rule");
      expect(parsedCommand.content).toBe("Rule content");
    });

    it("should support CommandOutput type", () => {
      const output: CommandOutput = {
        tool: "cursor",
        filepath: "./.cursor/commands/test.md",
        content: "Generated command content",
      };

      expect(output.tool).toBe("cursor");
      expect(output.filepath).toBe("./.cursor/commands/test.md");
      expect(output.content).toBe("Generated command content");
    });

    it("should support complex ParsedCommand structures", () => {
      const complexCommand: ParsedCommand = {
        frontmatter: {
          description: "Complex command with multiple properties",
          version: 1,
          enabled: true,
          tags: ["tag1", "tag2"],
          config: {
            timeout: 5000,
            retries: 3,
          },
        },
        content: "# Complex Command\n\nThis is a complex command with rich frontmatter.",
        filename: "complex-command.md",
        filepath: "./commands/complex-command.md",
        type: "command",
      };

      expect(complexCommand.frontmatter.description).toBe(
        "Complex command with multiple properties",
      );
      expect(complexCommand.frontmatter.version).toBe(1);
      expect(complexCommand.frontmatter.enabled).toBe(true);
      expect(complexCommand.frontmatter.tags).toEqual(["tag1", "tag2"]);
      expect(complexCommand.frontmatter.config).toEqual({ timeout: 5000, retries: 3 });
      expect(complexCommand.content).toContain("# Complex Command");
      expect(complexCommand.type).toBe("command");
    });
  });

  describe("schema validation edge cases", () => {
    it("should handle special characters in description", () => {
      const frontmatter = {
        description: "Special chars: !@#$%^&*()[]{}|\\;':\",./<>?`~",
      };

      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe(frontmatter.description);
    });

    it("should handle Unicode characters in description", () => {
      const frontmatter = {
        description: "Unicode test: 中文 العربية русский 🚀🎉",
      };

      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe(frontmatter.description);
    });

    it("should handle very long descriptions", () => {
      const longDescription = "Very long description " + "text ".repeat(1000);
      const frontmatter = { description: longDescription };

      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe(longDescription);
    });

    it("should handle multiline descriptions", () => {
      const multilineDescription = "Line 1\nLine 2\nLine 3\n\nParagraph 2";
      const frontmatter = { description: multilineDescription };

      const result = CommandFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe(multilineDescription);
    });
  });
});
