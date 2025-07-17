import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedRule } from "../../types/index.js";
import { createMockConfigByTool } from "../../test-utils/index.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateCursorConfig } from "./cursor.js";

vi.mock("../../utils/ignore.js", () => ({
  loadIgnorePatterns: vi.fn(),
}));

describe("generateCursorConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConfig = createMockConfigByTool("cursor", {
    outputPaths: {
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: "",
      roo: ".roo/rules",
      geminicli: "",
      kiro: ".kiro/steering",
    },
  });

  describe("rule type generation based on 4 type of .mdc", () => {
    it("should generate 'always' type for globs: ['**/*']", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const alwaysRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "API development rule",
          globs: ["**/*"],
        },
        content: "# Always Applied Rule\n\nThis rule applies to all files.",
        filename: "always-rule",
        filepath: ".rulesync/always-rule.md",
      };

      const outputs = await generateCursorConfig([alwaysRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: true");
      expect(outputs[0]!.content).toContain("# Always Applied Rule");
    });

    it("should generate 'manual' type for empty description and empty globs", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const manualRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        content: "# Manual Rule\n\nThis rule requires manual application.",
        filename: "manual-rule",
        filepath: ".rulesync/manual-rule.md",
      };

      const outputs = await generateCursorConfig([manualRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Manual Rule");
    });

    it("should generate 'specificFiles' type for empty description and non-empty globs", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const specificFilesRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: ["**/*.json", "**/*.ts", "**/*.js"],
        },
        content: "# Specific Files Rule\n\nThis rule applies to specific files.",
        filename: "specific-files-rule",
        filepath: ".rulesync/specific-files-rule.md",
      };

      const outputs = await generateCursorConfig([specificFilesRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs: **/*.json,**/*.ts,**/*.js");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Specific Files Rule");
    });

    it("should generate 'intelligently' type for non-empty description and empty globs", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const intelligentlyRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "API development rule",
          globs: [],
        },
        content: "# Intelligently Applied Rule\n\nThis rule is applied intelligently by AI.",
        filename: "intelligently-rule",
        filepath: ".rulesync/intelligently-rule.md",
      };

      const outputs = await generateCursorConfig([intelligentlyRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description: API development rule");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Intelligently Applied Rule");
    });

    it("should handle edge case: non-empty description and non-empty globs (should be intelligently)", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const edgeCaseRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "API development rule",
          globs: ["**/*.ts"],
        },
        content: "# Edge Case Rule\n\nThis has both description and globs.",
        filename: "edge-case-rule",
        filepath: ".rulesync/edge-case-rule.md",
      };

      const outputs = await generateCursorConfig([edgeCaseRule], mockConfig);

      expect(outputs).toHaveLength(1);
      // According to the specification order, this should be 'intelligently'
      // because it doesn't match 'always' (globs != ["**/*"]) or 'manual' (description not empty)
      // or 'specificFiles' (description not empty), so falls to 'intelligently'
      expect(outputs[0]!.content).toContain("description: API development rule");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
    });
  });

  describe("explicit cursorRuleType specification", () => {
    it("should use explicit cursorRuleType: always when specified", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const explicitAlwaysRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "API development rule",
          globs: ["**/*"],
          cursorRuleType: "always",
        },
        content: "# Explicit Always Rule\n\nThis rule is explicitly set as always.",
        filename: "explicit-always-rule",
        filepath: ".rulesync/explicit-always-rule.md",
      };

      const outputs = await generateCursorConfig([explicitAlwaysRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: true");
      expect(outputs[0]!.content).toContain("# Explicit Always Rule");
    });

    it("should use explicit cursorRuleType: specificFiles when specified", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const explicitSpecificFilesRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: ["**/*.json", "**/*.ts", "**/*.js"],
          cursorRuleType: "specificFiles",
        },
        content: "# Explicit Specific Files Rule\n\nThis rule is explicitly set as specificFiles.",
        filename: "explicit-specific-files-rule",
        filepath: ".rulesync/explicit-specific-files-rule.md",
      };

      const outputs = await generateCursorConfig([explicitSpecificFilesRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs: **/*.json,**/*.ts,**/*.js");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Explicit Specific Files Rule");
    });

    it("should use explicit cursorRuleType: intelligently when specified", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const explicitIntelligentlyRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "API development rule",
          globs: [],
          cursorRuleType: "intelligently",
        },
        content: "# Explicit Intelligently Rule\n\nThis rule is explicitly set as intelligently.",
        filename: "explicit-intelligently-rule",
        filepath: ".rulesync/explicit-intelligently-rule.md",
      };

      const outputs = await generateCursorConfig([explicitIntelligentlyRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description: API development rule");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Explicit Intelligently Rule");
    });

    it("should use explicit cursorRuleType: manual when specified", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const explicitManualRule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
          cursorRuleType: "manual",
        },
        content: "# Explicit Manual Rule\n\nThis rule is explicitly set as manual.",
        filename: "explicit-manual-rule",
        filepath: ".rulesync/explicit-manual-rule.md",
      };

      const outputs = await generateCursorConfig([explicitManualRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toContain("description:");
      expect(outputs[0]!.content).toContain("globs:");
      expect(outputs[0]!.content).toContain("alwaysApply: false");
      expect(outputs[0]!.content).toContain("# Explicit Manual Rule");
    });
  });

  describe("ignore file generation", () => {
    const testRule: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["*"],
        description: "Test rule",
        globs: ["**/*.ts"],
      },
      content: "Test rule content",
      filename: "test-rule",
      filepath: ".rulesync/test-rule.md",
    };

    it("should generate .cursorignore when .rulesyncignore exists", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({
        patterns: ["*.test.md", "temp/**/*"],
      });

      const outputs = await generateCursorConfig([testRule], mockConfig);

      expect(outputs).toHaveLength(2);

      // Check rule file
      expect(outputs[0]!.filepath).toBe(".cursor/rules/test-rule.mdc");

      // Check .cursorignore file
      expect(outputs[1]).toEqual({
        tool: "cursor",
        filepath: ".cursorignore",
        content: expect.stringContaining("# Generated by rulesync from .rulesyncignore"),
      });
      expect(outputs[1]!.content).toContain("*.test.md");
      expect(outputs[1]!.content).toContain("temp/**/*");
    });

    it("should not generate .cursorignore when no ignore patterns exist", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

      const outputs = await generateCursorConfig([testRule], mockConfig);

      expect(outputs).toHaveLength(1);
      expect(outputs.every((o) => o.filepath !== ".cursorignore")).toBe(true);
    });

    it("should respect baseDir parameter", async () => {
      vi.mocked(loadIgnorePatterns).mockResolvedValue({
        patterns: ["*.test.md"],
      });

      const outputs = await generateCursorConfig([testRule], mockConfig, "/custom/base");

      expect(outputs).toHaveLength(2);
      expect(outputs[0]!.filepath).toBe("/custom/base/.cursor/rules/test-rule.mdc");
      expect(outputs[1]!.filepath).toBe("/custom/base/.cursorignore");
    });
  });
});
