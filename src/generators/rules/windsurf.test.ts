import { describe, expect, it } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { generateWindsurfConfig } from "./windsurf.js";

const mockConfig = createMockConfig();

describe("generateWindsurfConfig", () => {
  it("should generate directory variant by default", async () => {
    const rules = [
      {
        frontmatter: {
          root: false,
          targets: ["windsurf"] as ToolTarget[],
          description: "Test Rule",
          globs: [],
          tags: [],
        },
        content: "# Test Rule\nThis is a test rule.",
        filename: "test-rule",
        filepath: "/src/rules/test-rule.md",
      },
    ];

    const outputs = await generateWindsurfConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // Rule file + ignore file

    const ruleOutput = outputs.find((o) => o.filepath.includes(".windsurf/rules/"));
    expect(ruleOutput?.tool).toBe("windsurf");
    expect(ruleOutput?.filepath).toContain(".windsurf/rules/test-rule.md");
    expect(ruleOutput?.content.trim()).toBe("# Test Rule\nThis is a test rule.");
  });

  it("should generate single-file variant when specified", async () => {
    const rules = [
      {
        frontmatter: {
          root: false,
          targets: ["windsurf"] as ToolTarget[],
          description: "Test Rule",
          globs: [],
          windsurfOutputFormat: "single-file" as const,
          tags: [],
        },
        content: "# Test Rule\nThis is a test rule.",
        filename: "test-rule",
        filepath: "/src/rules/test-rule.md",
      },
    ];

    const outputs = await generateWindsurfConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // Rule file + ignore file

    const ruleOutput = outputs.find((o) => o.filepath.includes(".windsurf-rules"));
    expect(ruleOutput?.tool).toBe("windsurf");
    expect(ruleOutput?.filepath).toContain(".windsurf-rules");
    expect(ruleOutput?.content.trim()).toBe("# Test Rule\nThis is a test rule.");
  });

  it("should add YAML frontmatter for activation modes", async () => {
    const rules = [
      {
        frontmatter: {
          root: false,
          targets: ["windsurf"] as ToolTarget[],
          description: "Test Rule",
          globs: ["**/*.tsx"],
          windsurfActivationMode: "glob" as const,
          tags: [],
        },
        content: "# React Component Rules\n- Use functional components",
        filename: "react-rules",
        filepath: "/src/rules/react-rules.md",
      },
    ];

    const outputs = await generateWindsurfConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // Rule file + ignore file

    const ruleOutput = outputs.find((o) => o.filepath.includes(".windsurf/rules/"));
    expect(ruleOutput?.content).toContain("---");
    expect(ruleOutput?.content).toContain("activation: glob");
    expect(ruleOutput?.content).toContain('pattern: "**/*.tsx"');
    expect(ruleOutput?.content).toContain("# React Component Rules");
  });

  it("should not add frontmatter when no activation mode is specified", async () => {
    const rules = [
      {
        frontmatter: {
          root: false,
          targets: ["windsurf"] as ToolTarget[],
          description: "Test Rule",
          globs: [],
          tags: [],
        },
        content: "# Simple Rule\nThis is a simple rule.",
        filename: "simple-rule",
        filepath: "/src/rules/simple-rule.md",
      },
    ];

    const outputs = await generateWindsurfConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // Rule file + ignore file

    const ruleOutput = outputs.find((o) => o.filepath.includes(".windsurf/rules/"));
    expect(ruleOutput?.content).not.toContain("---");
    expect(ruleOutput?.content.trim()).toBe("# Simple Rule\nThis is a simple rule.");
  });

  it("should handle always-on activation mode", async () => {
    const rules = [
      {
        frontmatter: {
          root: false,
          targets: ["windsurf"] as ToolTarget[],
          description: "Always Active Rule",
          globs: [],
          windsurfActivationMode: "always" as const,
          tags: [],
        },
        content: "# Always Active Rule\nThis rule is always active.",
        filename: "always-rule",
        filepath: "/src/rules/always-rule.md",
      },
    ];

    const outputs = await generateWindsurfConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // Rule file + ignore file

    const ruleOutput = outputs.find((o) => o.filepath.includes(".windsurf/rules/"));
    expect(ruleOutput?.content).toContain("---");
    expect(ruleOutput?.content).toContain("activation: always");
    expect(ruleOutput?.content).not.toContain("pattern:");
  });
});
