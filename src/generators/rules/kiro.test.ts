import { describe, expect, it } from "vitest";
import { createMockConfigByTool } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { generateKiroConfig } from "./kiro.js";

describe("generateKiroConfig", () => {
  const mockConfig = createMockConfigByTool("kiro");

  const mockRule: ParsedRule = {
    frontmatter: {
      root: false,
      targets: ["kiro"],
      description: "Security guidelines",
      globs: ["**/*.ts"],
    },
    content: "# Security Guidelines\n\n- Never hardcode API keys\n- Use environment variables",
    filename: "security-guidelines",
    filepath: ".rulesync/security-guidelines.md",
  };

  it("should generate kiro custom steering documents", async () => {
    const outputs = await generateKiroConfig([mockRule], mockConfig);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      tool: "kiro",
      filepath: ".kiro/steering/security-guidelines.md",
      content: "# Security Guidelines\n\n- Never hardcode API keys\n- Use environment variables",
    });
  });

  it("should generate multiple steering documents", async () => {
    const mockRules: ParsedRule[] = [
      {
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Security guidelines",
          globs: ["**/*.ts"],
        },
        content: "# Security Guidelines\n\nSecurity rules here",
        filename: "security",
        filepath: ".rulesync/security.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Deployment process",
          globs: ["**/*"],
        },
        content: "# Deployment Process\n\nDeployment steps here",
        filename: "deployment",
        filepath: ".rulesync/deployment.md",
      },
    ];

    const outputs = await generateKiroConfig(mockRules, mockConfig);

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toEqual({
      tool: "kiro",
      filepath: ".kiro/steering/security.md",
      content: "# Security Guidelines\n\nSecurity rules here",
    });
    expect(outputs[1]).toEqual({
      tool: "kiro",
      filepath: ".kiro/steering/deployment.md",
      content: "# Deployment Process\n\nDeployment steps here",
    });
  });

  it("should respect baseDir parameter", async () => {
    const outputs = await generateKiroConfig([mockRule], mockConfig, "/custom/base");

    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.filepath).toBe("/custom/base/.kiro/steering/security-guidelines.md");
  });

  it("should handle empty rules array", async () => {
    const outputs = await generateKiroConfig([], mockConfig);

    expect(outputs).toHaveLength(0);
  });

  it("should trim content whitespace", async () => {
    const mockRuleWithWhitespace: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["kiro"],
        description: "Test rule",
        globs: ["**/*.ts"],
      },
      content: "\n\n  # Test Content  \n\n  ",
      filename: "test-rule",
      filepath: ".rulesync/test-rule.md",
    };

    const outputs = await generateKiroConfig([mockRuleWithWhitespace], mockConfig);

    expect(outputs[0]?.content).toBe("# Test Content");
  });
});
