import { describe, expect, it } from "vitest";
import type { Config, ParsedRule } from "../../types/index.js";
import { generateJunieConfig } from "./junie.js";

describe("generateJunieConfig", () => {
  const mockConfig: Config = {
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
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
      junie: ".",
    },
    watchEnabled: false,
    defaultTargets: ["junie"],
  };

  it("should generate guidelines.md with root rules first", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: true,
          targets: ["junie"],
          description: "Main guidelines",
          globs: ["**/*"],
        },
        content: "# Main Guidelines\nThis is the main content.",
        filename: "main",
        filepath: "/test/main.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["junie"],
          description: "Detail rule",
          globs: ["src/**/*"],
        },
        content: "# Detail Rule\nThis is detail content.",
        filename: "detail",
        filepath: "/test/detail.md",
      },
    ];

    const outputs = await generateJunieConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // guidelines.md + .aiignore

    // Find the guidelines file
    const guidelinesFile = outputs.find((o) => o.filepath === ".junie/guidelines.md");
    expect(guidelinesFile).toBeDefined();
    expect(guidelinesFile?.tool).toBe("junie");
    expect(guidelinesFile?.content).toContain("# Main Guidelines");
    expect(guidelinesFile?.content).toContain("# Detail Rule");

    // Check that root rules come first
    const content = guidelinesFile?.content || "";
    const mainIndex = content.indexOf("# Main Guidelines");
    const detailIndex = content.indexOf("# Detail Rule");
    expect(mainIndex).toBeLessThan(detailIndex);
  });

  it("should generate guidelines.md with detail rules only", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: false,
          targets: ["junie"],
          description: "Detail rule 1",
          globs: ["src/**/*"],
        },
        content: "# Detail Rule 1\nFirst detail content.",
        filename: "detail1",
        filepath: "/test/detail1.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["junie"],
          description: "Detail rule 2",
          globs: ["tests/**/*"],
        },
        content: "# Detail Rule 2\nSecond detail content.",
        filename: "detail2",
        filepath: "/test/detail2.md",
      },
    ];

    const outputs = await generateJunieConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // guidelines.md + .aiignore

    // Find the guidelines file
    const guidelinesFile = outputs.find((o) => o.filepath === ".junie/guidelines.md");
    expect(guidelinesFile).toBeDefined();
    expect(guidelinesFile?.content).toContain("# Detail Rule 1");
    expect(guidelinesFile?.content).toContain("# Detail Rule 2");
  });

  it("should generate empty guidelines.md for empty rules", async () => {
    const rules: ParsedRule[] = [];

    const outputs = await generateJunieConfig(rules, mockConfig);

    expect(outputs).toHaveLength(2); // guidelines.md + .aiignore

    // Find the guidelines file
    const guidelinesFile = outputs.find((o) => o.filepath === ".junie/guidelines.md");
    expect(guidelinesFile).toBeDefined();
    expect(guidelinesFile?.content).toBe("");
  });

  it("should use baseDir when provided", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: true,
          targets: ["junie"],
          description: "Main guidelines",
          globs: ["**/*"],
        },
        content: "# Guidelines",
        filename: "main",
        filepath: "/test/main.md",
      },
    ];

    const outputs = await generateJunieConfig(rules, mockConfig, "/custom/base");

    expect(outputs[0]?.filepath).toBe("/custom/base/.junie/guidelines.md");
  });
});
