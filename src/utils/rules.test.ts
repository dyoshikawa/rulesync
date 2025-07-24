import { describe, expect, it } from "vitest";
import { ALL_TOOL_TARGETS, type ParsedRule } from "../types/index.js";
import { isToolSpecificRule } from "./rules.js";

const createRule = (filename: string): ParsedRule => ({
  filename,
  filepath: `.rulesync/${filename}.md`,
  frontmatter: {
    root: false,
    targets: ["*"] as ["*"],
    description: "Test rule",
    globs: ["**/*.ts"],
  },
  content: "Test content",
});

describe("isToolSpecificRule", () => {
  describe("tool-specific specifications", () => {
    it("should return true for copilot specification when target is copilot", () => {
      const rule = createRule("specification-copilot-rules");
      expect(isToolSpecificRule(rule, "copilot")).toBe(true);
    });

    it("should return false for copilot specification when target is not copilot", () => {
      const rule = createRule("specification-copilot-rules");
      expect(isToolSpecificRule(rule, "cursor")).toBe(false);
      expect(isToolSpecificRule(rule, "claudecode")).toBe(false);
      expect(isToolSpecificRule(rule, "geminicli")).toBe(false);
    });

    it("should handle all tool-specific patterns correctly", () => {
      const testCases = [
        { filename: "specification-cursor-rules", tool: "cursor" },
        { filename: "specification-cline-mcp", tool: "cline" },
        { filename: "specification-claudecode-ignore", tool: "claudecode" },
        { filename: "specification-augmentcode-rules", tool: "augmentcode" },
        { filename: "specification-roo-mcp", tool: "roo" },
        { filename: "specification-geminicli-rules", tool: "geminicli" },
        { filename: "specification-kiro-ignore", tool: "kiro" },
      ] as const;

      for (const { filename, tool } of testCases) {
        const rule = createRule(filename);
        expect(isToolSpecificRule(rule, tool)).toBe(true);

        // Should be false for all other tools
        const allOtherTools = ALL_TOOL_TARGETS.filter((t) => t !== tool);
        for (const otherTool of allOtherTools) {
          if (otherTool !== tool) {
            expect(isToolSpecificRule(rule, otherTool)).toBe(false);
          }
        }
      }
    });
  });

  describe("non-tool-specific files", () => {
    it("should return true for general rules", () => {
      const generalRules = [
        "coding-standards",
        "project-guidelines",
        "security-best-practices",
        "build-tooling",
        "docs-maintenance",
      ];

      for (const filename of generalRules) {
        const rule = createRule(filename);
        // Should be true for all tools
        expect(isToolSpecificRule(rule, "copilot")).toBe(true);
        expect(isToolSpecificRule(rule, "cursor")).toBe(true);
        expect(isToolSpecificRule(rule, "claudecode")).toBe(true);
        expect(isToolSpecificRule(rule, "geminicli")).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle case-insensitive matching", () => {
      const rule = createRule("SPECIFICATION-COPILOT-RULES");
      expect(isToolSpecificRule(rule, "copilot")).toBe(true);
      expect(isToolSpecificRule(rule, "cursor")).toBe(false);
    });

    it("should handle files with specification in name but not tool-specific", () => {
      const rule = createRule("api-specification");
      // Should be true for all tools since it's not tool-specific
      expect(isToolSpecificRule(rule, "copilot")).toBe(true);
      expect(isToolSpecificRule(rule, "cursor")).toBe(true);
    });

    it("should handle augmentcode vs augmentcode-legacy", () => {
      const augmentRule = createRule("specification-augmentcode-rules");
      const legacyRule = createRule("specification-augmentcode-legacy-rules");

      expect(isToolSpecificRule(augmentRule, "augmentcode")).toBe(true);
      expect(isToolSpecificRule(augmentRule, "augmentcode-legacy")).toBe(false);

      expect(isToolSpecificRule(legacyRule, "augmentcode-legacy")).toBe(true);
      expect(isToolSpecificRule(legacyRule, "augmentcode")).toBe(false);
    });
  });
});
