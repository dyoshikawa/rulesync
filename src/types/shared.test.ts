import { describe, expect, it } from "vitest";
import {
  type BaseFrontmatter,
  BaseFrontmatterSchema,
  type Output,
  OutputSchema,
  type ParsedContent,
} from "./shared.js";

describe("shared types", () => {
  describe("OutputSchema", () => {
    it("should validate complete output object", () => {
      const output = {
        tool: "cursor",
        filepath: "./.cursor/rules/test.md",
        content: "# Test Rule\nContent here",
      };

      const result = OutputSchema.parse(output);
      expect(result).toEqual(output);
    });

    it("should validate all supported tools", () => {
      const tools = [
        "agentsmd",
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "opencode",
        "qwencode",
        "roo",
        "geminicli",
        "kiro",
        "junie",
        "windsurf",
      ];

      for (const tool of tools) {
        const output = {
          tool,
          filepath: `./config/${tool}.md`,
          content: `Content for ${tool}`,
        };

        expect(() => OutputSchema.parse(output)).not.toThrow();
        const result = OutputSchema.parse(output);
        expect(result.tool).toBe(tool);
      }
    });

    it("should reject invalid tool names", () => {
      const invalidOutputs = [
        {
          tool: "invalid-tool",
          filepath: "./test.md",
          content: "content",
        },
        {
          tool: "*", // wildcard not allowed in OutputSchema
          filepath: "./test.md",
          content: "content",
        },
        {
          tool: "",
          filepath: "./test.md",
          content: "content",
        },
      ];

      for (const output of invalidOutputs) {
        expect(() => OutputSchema.parse(output)).toThrow();
      }
    });

    it("should require all fields", () => {
      const incompleteOutputs = [
        { tool: "cursor", filepath: "./test.md" }, // missing content
        { tool: "cursor", content: "content" }, // missing filepath
        { filepath: "./test.md", content: "content" }, // missing tool
        {}, // missing all
      ];

      for (const output of incompleteOutputs) {
        expect(() => OutputSchema.parse(output)).toThrow();
      }
    });

    it("should reject non-string values", () => {
      const invalidOutputs = [
        { tool: "cursor", filepath: 123, content: "content" },
        { tool: "cursor", filepath: "./test.md", content: null },
        { tool: null, filepath: "./test.md", content: "content" },
      ];

      for (const output of invalidOutputs) {
        expect(() => OutputSchema.parse(output)).toThrow();
      }
    });

    it("should handle various file paths and content types", () => {
      const validOutputs = [
        {
          tool: "cursor",
          filepath: "./.cursor/rules/coding-standards.md",
          content: "# Coding Standards\n\n- Use TypeScript",
        },
        {
          tool: "copilot",
          filepath: "./.github/copilot-instructions.md",
          content: "",
        },
        {
          tool: "claudecode",
          filepath: "./CLAUDE.md",
          content: "Single line content",
        },
      ];

      for (const output of validOutputs) {
        expect(() => OutputSchema.parse(output)).not.toThrow();
        const result = OutputSchema.parse(output);
        expect(result).toEqual(output);
      }
    });
  });

  describe("BaseFrontmatterSchema", () => {
    it("should validate empty object", () => {
      const result = BaseFrontmatterSchema.parse({});
      expect(result).toEqual({});
    });

    it("should validate object with description", () => {
      const frontmatter = { description: "Test description" };
      const result = BaseFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual(frontmatter);
    });

    it("should validate object with undefined description", () => {
      const frontmatter = { description: undefined };
      const result = BaseFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual({ description: undefined });
    });

    it("should allow additional properties", () => {
      const frontmatter = {
        description: "Test description",
        additionalProp: "value",
        anotherProp: 123,
        nested: { object: "value" },
      };

      const result = BaseFrontmatterSchema.parse(frontmatter);
      expect(result.description).toBe("Test description");
      // Additional properties behavior depends on Zod configuration
    });

    it("should reject non-string descriptions", () => {
      const invalidFrontmatters = [
        { description: 123 },
        { description: null },
        { description: [] },
        { description: {} },
        { description: true },
      ];

      for (const frontmatter of invalidFrontmatters) {
        expect(() => BaseFrontmatterSchema.parse(frontmatter)).toThrow();
      }
    });

    it("should handle empty string description", () => {
      const frontmatter = { description: "" };
      const result = BaseFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual(frontmatter);
    });

    it("should handle multiline descriptions", () => {
      const frontmatter = {
        description: "Line 1\nLine 2\nLine 3",
      };
      const result = BaseFrontmatterSchema.parse(frontmatter);
      expect(result).toEqual(frontmatter);
    });
  });

  describe("type definitions", () => {
    it("should have correct Output type", () => {
      const output: Output = {
        tool: "cursor",
        filepath: "./test.md",
        content: "content",
      };

      expect(output.tool).toBe("cursor");
      expect(output.filepath).toBe("./test.md");
      expect(output.content).toBe("content");
    });

    it("should have correct BaseFrontmatter type", () => {
      const frontmatter: BaseFrontmatter = {
        description: "Test description",
      };

      expect(frontmatter.description).toBe("Test description");

      const minimalFrontmatter: BaseFrontmatter = {};
      expect(minimalFrontmatter).toEqual({});
    });

    it("should have correct ParsedContent type", () => {
      const parsedContent: ParsedContent = {
        frontmatter: { description: "Test" },
        content: "File content",
        filename: "test.md",
        filepath: "./test.md",
      };

      expect(parsedContent.frontmatter).toEqual({ description: "Test" });
      expect(parsedContent.content).toBe("File content");
      expect(parsedContent.filename).toBe("test.md");
      expect(parsedContent.filepath).toBe("./test.md");
    });

    it("should support complex frontmatter in ParsedContent", () => {
      const parsedContent: ParsedContent = {
        frontmatter: {
          description: "Complex test",
          tags: ["tag1", "tag2"],
          config: { nested: "value" },
          enabled: true,
        },
        content: "Complex file content",
        filename: "complex.md",
        filepath: "./complex.md",
      };

      expect(parsedContent.frontmatter.description).toBe("Complex test");
      expect(parsedContent.frontmatter.tags).toEqual(["tag1", "tag2"]);
      expect(parsedContent.frontmatter.config).toEqual({ nested: "value" });
      expect(parsedContent.frontmatter.enabled).toBe(true);
    });
  });
});
