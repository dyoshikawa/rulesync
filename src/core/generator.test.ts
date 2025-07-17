import { describe, expect, it } from "vitest";
import { createMockConfig } from "../test-utils/index.js";
import type { ParsedRule } from "../types/index.js";
import { generateConfigurations } from "./generator.js";

const mockConfig = createMockConfig({
  outputPaths: {
    copilot: ".github/instructions",
    cursor: ".cursor/rules",
    cline: ".clinerules",
    claudecode: ".",
    geminicli: ".geminicli",
    roo: ".roo",
    kiro: ".kiro/steering",
  },
});

const mockRules: ParsedRule[] = [
  {
    filename: "test-rule",
    filepath: "/path/to/test-rule.md",
    frontmatter: {
      targets: ["*"],
      root: true,
      description: "Test rule",
      globs: ["**/*.ts"],
    },
    content: "This is a test rule",
  },
  {
    filename: "copilot-only",
    filepath: "/path/to/copilot-only.md",
    frontmatter: {
      targets: ["copilot"],
      root: false,
      description: "Copilot only rule",
      globs: ["**/*.js"],
    },
    content: "This is a copilot only rule",
  },
  {
    filename: "claudecode-only",
    filepath: "/path/to/claudecode-only.md",
    frontmatter: {
      targets: ["claudecode"],
      root: false,
      description: "Claudecode only rule",
      globs: ["**/*.tsx"],
    },
    content: "This is a claudecode only rule",
  },
];

describe("generateConfigurations", () => {
  it("should generate configurations for all default targets", async () => {
    const outputs = await generateConfigurations(mockRules, mockConfig);

    // Claude generates multiple files, so count will be higher
    expect(outputs.length).toBeGreaterThanOrEqual(4);
    const tools = [...new Set(outputs.map((o) => o.tool))];
    expect(tools).toEqual(expect.arrayContaining(["copilot", "cursor", "cline", "claudecode"]));
  });

  it("should generate configurations for specified targets only", async () => {
    const outputs = await generateConfigurations(mockRules, mockConfig, ["copilot"]);

    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every((o) => o.tool === "copilot")).toBe(true);
  });

  it("should filter rules correctly for each tool", async () => {
    const outputs = await generateConfigurations(mockRules, mockConfig, ["copilot"]);

    const allContent = outputs.map((o) => o.content).join(" ");
    expect(allContent).toContain("This is a test rule");
    expect(allContent).toContain("This is a copilot only rule");
    expect(allContent).not.toContain("This is a claudecode only rule");
  });

  it("should generate claudecode configuration correctly", async () => {
    const outputs = await generateConfigurations(mockRules, mockConfig, ["claudecode"]);

    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs[0]!.tool).toBe("claudecode");
    expect(outputs[0]!.filepath).toBe("CLAUDE.md");
    expect(outputs[0]!.content).toContain("This is a test rule");
    expect(outputs[0]!.content).toContain("@.claude/memories/claudecode-only.md");
    expect(outputs[0]!.content).not.toContain("This is a copilot only rule");
  });

  it("should handle empty rules gracefully", async () => {
    const outputs = await generateConfigurations([], mockConfig);

    expect(outputs).toHaveLength(0);
  });

  it("should handle unknown tools gracefully", async () => {
    // TypeScript will prevent us from passing invalid tools at compile time,
    // but we can test the runtime behavior by passing an empty array
    const outputs = await generateConfigurations(mockRules, mockConfig, []);

    expect(outputs).toHaveLength(0);
  });
});
