import { describe, expect, it } from "vitest";
import type { ParsedRule } from "../../types/index.js";
import { getDefaultConfig } from "../../utils/config.js";
import { generateAugmentcodeConfig } from "./augmentcode.js";

describe("augmentcode generator", () => {
  const config = getDefaultConfig();

  const mockRules: ParsedRule[] = [
    {
      frontmatter: {
        root: true,
        targets: ["augmentcode"],
        description: "Root coding guidelines",
        globs: ["**/*.ts"],
      },
      content: "Use TypeScript for all new code.\nFollow clean architecture.",
      filename: "coding-guidelines",
      filepath: "/test/coding-guidelines.md",
    },
    {
      frontmatter: {
        root: false,
        targets: ["augmentcode"],
        description: "Architecture patterns and best practices",
        globs: ["**/*.tsx", "src/**/*.ts"],
        tags: ["architecture", "patterns"],
      },
      content: "Follow clean architecture principles.\nSeparate concerns properly.",
      filename: "architecture-manual",
      filepath: "/test/architecture-manual.md",
    },
    {
      frontmatter: {
        root: false,
        targets: ["augmentcode"],
        description: "Naming conventions for variables and functions",
        globs: ["**/*.js"],
      },
      content: "Use camelCase for variables.\nUse PascalCase for components.",
      filename: "naming-always",
      filepath: "/test/naming-always.md",
    },
    {
      frontmatter: {
        root: false,
        targets: ["augmentcode"],
        description: "Onboarding checklist and development setup guide",
        globs: ["**/*.md"],
        tags: ["onboarding", "setup"],
      },
      content: "Follow the onboarding checklist.\nSet up development environment properly.",
      filename: "onboarding-auto",
      filepath: "/test/onboarding-auto.md",
    },
  ];

  it("should generate augmentcode configuration", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    expect(outputs).toHaveLength(4); // 4 rule files (no guidelines file)
    expect(outputs.every((o) => o.tool === "augmentcode")).toBe(true);
  });

  it("should generate all rules as individual files", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    // All rules should generate .augment/rules/*.md files (no guidelines file)
    const ruleFiles = outputs.filter((o) => o.filepath.includes(".augment/rules/"));
    expect(ruleFiles).toHaveLength(4);

    // Check that all rule files are present
    const filenames = ruleFiles.map((f) => f.filepath.split("/").pop());
    expect(filenames).toContain("coding-guidelines.md");
    expect(filenames).toContain("architecture-manual.md");
    expect(filenames).toContain("naming-always.md");
    expect(filenames).toContain("onboarding-auto.md");
  });

  it("should generate proper rule file format with frontmatter", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    const manualRule = outputs.find((o) => o.filepath.includes("architecture-manual.md"));
    expect(manualRule).toBeDefined();
    expect(manualRule!.content).toContain("---");
    expect(manualRule!.content).toContain("type: manual");
    expect(manualRule!.content).toContain(
      'description: "Architecture patterns and best practices"',
    );
    expect(manualRule!.content).toContain('tags: ["architecture", "patterns"]');
    expect(manualRule!.content).toContain("Follow clean architecture principles.");
  });

  it("should detect always rule type from filename", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    const alwaysRule = outputs.find((o) => o.filepath.includes("naming-always.md"));
    expect(alwaysRule).toBeDefined();
    expect(alwaysRule!.content).toContain("type: always");
    expect(alwaysRule!.content).toContain('description: ""'); // Always rules should have blank description
    expect(alwaysRule!.content).toContain("Use camelCase for variables.");
  });

  it("should detect auto rule type from filename", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    const autoRule = outputs.find((o) => o.filepath.includes("onboarding-auto.md"));
    expect(autoRule).toBeDefined();
    expect(autoRule!.content).toContain("type: auto");
    expect(autoRule!.content).toContain(
      'description: "Onboarding checklist and development setup guide"',
    );
    expect(autoRule!.content).toContain('tags: ["onboarding", "setup"]');
    expect(autoRule!.content).toContain("Follow the onboarding checklist.");
  });

  it("should default to manual rule type", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    const manualRule = outputs.find((o) => o.filepath.includes("architecture-manual.md"));
    expect(manualRule).toBeDefined();
    expect(manualRule!.content).toContain("type: manual");
    expect(manualRule!.content).toContain(
      'description: "Architecture patterns and best practices"',
    );
  });

  it("should handle rules without tags", async () => {
    const ruleWithoutTags: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["augmentcode"],
        description: "Rule without tags",
        globs: ["**/*.ts"],
      },
      content: "Some rule content.",
      filename: "simple-rule",
      filepath: "/test/simple-rule.md",
    };

    const outputs = await generateAugmentcodeConfig([ruleWithoutTags], config);

    expect(outputs[0]!.content).toContain("type: manual");
    expect(outputs[0]!.content).toContain('description: "Rule without tags"');
    expect(outputs[0]!.content).not.toContain("tags:");
    expect(outputs[0]!.content).toContain("Some rule content.");
  });

  it("should handle empty rules array", async () => {
    const outputs = await generateAugmentcodeConfig([], config);

    expect(outputs).toHaveLength(0);
  });

  it("should handle only root rules", async () => {
    const rootOnlyRules = mockRules.filter((r) => r.frontmatter.root === true);
    const outputs = await generateAugmentcodeConfig(rootOnlyRules, config);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.filepath).toMatch(/\.augment\/rules\/coding-guidelines\.md$/);
    expect(outputs[0]!.content).toContain("Use TypeScript for all new code.");
  });

  it("should handle only detail rules", async () => {
    const detailOnlyRules = mockRules.filter((r) => r.frontmatter.root === false);
    const outputs = await generateAugmentcodeConfig(detailOnlyRules, config);

    expect(outputs).toHaveLength(3);
    expect(outputs.every((o) => o.filepath.includes(".augment/rules/"))).toBe(true);
  });

  it("should respect baseDir parameter", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config, "/custom/base");

    const ruleFile = outputs.find((o) => o.filepath.includes("architecture-manual.md"));
    expect(ruleFile!.filepath).toBe("/custom/base/.augment/rules/architecture-manual.md");

    const codingFile = outputs.find((o) => o.filepath.includes("coding-guidelines.md"));
    expect(codingFile!.filepath).toBe("/custom/base/.augment/rules/coding-guidelines.md");
  });

  it("should generate correct file paths", async () => {
    const outputs = await generateAugmentcodeConfig(mockRules, config);

    const expectedPaths = [
      ".augment/rules/coding-guidelines.md",
      ".augment/rules/architecture-manual.md",
      ".augment/rules/naming-always.md",
      ".augment/rules/onboarding-auto.md",
    ];

    const actualPaths = outputs.map((o) => o.filepath);
    expect(actualPaths).toEqual(expect.arrayContaining(expectedPaths));
  });

  it("should trim rule content", async () => {
    const ruleWithWhitespace: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["augmentcode"],
        description: "Rule with whitespace",
        globs: ["**/*.ts"],
      },
      content: "\n\n  Some rule content with whitespace.  \n\n",
      filename: "whitespace-rule",
      filepath: "/test/whitespace-rule.md",
    };

    const outputs = await generateAugmentcodeConfig([ruleWithWhitespace], config);

    expect(outputs[0]!.content).toContain("Some rule content with whitespace.");
    expect(outputs[0]!.content).not.toMatch(/^\n/);
    expect(outputs[0]!.content).not.toMatch(/\n$/);
  });
});
