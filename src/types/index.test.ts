import { describe, expect, it } from "vitest";
import type { Config, GeneratedOutput, ParsedRule, RuleFrontmatter, ToolTarget } from "./index.js";

describe("types/index", () => {
  it("should define proper type structure for RuleFrontmatter", () => {
    const ruleFrontmatter: RuleFrontmatter = {
      root: true,
      targets: ["*"],
      description: "Test rule",
      globs: ["**/*.ts"],
    };

    expect(ruleFrontmatter.root).toBe(true);
    expect(ruleFrontmatter.targets).toEqual(["*"]);
    expect(ruleFrontmatter.description).toBe("Test rule");
    expect(ruleFrontmatter.globs).toEqual(["**/*.ts"]);
  });

  it("should define proper type structure for ParsedRule", () => {
    const parsedRule: ParsedRule = {
      filename: "test-rule",
      filepath: "/path/to/test-rule.md",
      frontmatter: {
        root: false,
        targets: ["copilot", "cursor"],
        description: "Test rule",
        globs: ["**/*.js"],
      },
      content: "# Test Rule\n\nContent here",
    };

    expect(parsedRule.filename).toBe("test-rule");
    expect(parsedRule.filepath).toBe("/path/to/test-rule.md");
    expect(parsedRule.frontmatter.root).toBe(false);
    expect(parsedRule.content).toContain("Test Rule");
  });

  it("should define proper type structure for GeneratedOutput", () => {
    const generatedOutput: GeneratedOutput = {
      tool: "copilot",
      filepath: "/path/to/output.md",
      content: "Generated content",
    };

    expect(generatedOutput.tool).toBe("copilot");
    expect(generatedOutput.filepath).toBe("/path/to/output.md");
    expect(generatedOutput.content).toBe("Generated content");
  });

  it("should define proper type structure for Config", () => {
    const config: Config = {
      aiRulesDir: ".rulesync",
      outputPaths: {
        augmentcode: ".",
        "augmentcode-legacy": ".",
        copilot: ".github/instructions",
        cursor: ".cursor/rules",
        cline: ".clinerules",
        claudecode: ".",
        codexcli: ".",
        roo: ".roo/rules",
        geminicli: ".geminicli/rules",
        kiro: ".kiro/steering",
        junie: ".",
        windsurf: ".",
      },
      defaultTargets: [
        "augmentcode",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "roo",
        "geminicli",
        "kiro",
      ],
      watchEnabled: false,
    };

    expect(config.aiRulesDir).toBe(".rulesync");
    expect(config.outputPaths.copilot).toBe(".github/instructions");
    expect(config.defaultTargets).toContain("copilot");
    expect(config.watchEnabled).toBe(false);
  });

  it("should validate ToolTarget type constraints", () => {
    const validTargets: ToolTarget[] = [
      "augmentcode",
      "copilot",
      "cursor",
      "cline",
      "claudecode",
      "codexcli",
      "roo",
      "geminicli",
      "kiro",
    ];

    for (const target of validTargets) {
      expect([
        "augmentcode",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "roo",
        "geminicli",
        "kiro",
      ]).toContain(target);
    }
  });

  it("should handle wildcard targets in RuleFrontmatter", () => {
    const wildcardRule: RuleFrontmatter = {
      root: true,
      targets: ["*"],
      description: "Wildcard rule",
      globs: [],
    };

    expect(wildcardRule.targets).toEqual(["*"]);
  });

  it("should handle multiple specific targets in RuleFrontmatter", () => {
    const multiTargetRule: RuleFrontmatter = {
      root: false,
      targets: ["copilot", "cursor", "claudecode"],
      description: "Multi-target rule",
      globs: ["**/*.ts", "**/*.js"],
    };

    expect(multiTargetRule.targets).toHaveLength(3);
    expect(multiTargetRule.globs).toHaveLength(2);
  });
});
