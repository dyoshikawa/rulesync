import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfigByTool } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateClineConfig } from "./cline.js";

vi.mock("../../utils/ignore.js", () => ({
  loadIgnorePatterns: vi.fn(),
}));

describe("generateClineConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConfig = createMockConfigByTool("cline");

  const mockRule: ParsedRule = {
    frontmatter: {
      root: true,
      targets: ["cline"],
      description: "Test rule",
      globs: ["**/*.ts"],
    },
    content: "Test rule content",
    filename: "test-rule",
    filepath: ".rulesync/test-rule.md",
  };

  it("should generate cline config files", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

    const outputs = await generateClineConfig([mockRule], mockConfig);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      tool: "cline",
      filepath: ".clinerules/test-rule.md",
      content: "Test rule content",
    });
  });

  it("should generate .clineignore when .rulesyncignore exists", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "temp/**/*"],
    });

    const outputs = await generateClineConfig([mockRule], mockConfig);

    expect(outputs).toHaveLength(2);

    // Check rule file
    expect(outputs[0]?.filepath).toBe(".clinerules/test-rule.md");

    // Check .clineignore file
    expect(outputs[1]).toEqual({
      tool: "cline",
      filepath: ".clineignore",
      content: expect.stringContaining("# Generated by rulesync from .rulesyncignore"),
    });
    expect(outputs[1]?.content).toContain("*.test.md");
    expect(outputs[1]?.content).toContain("temp/**/*");
  });

  it("should not generate .clineignore when no ignore patterns exist", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

    const outputs = await generateClineConfig([mockRule], mockConfig);

    expect(outputs).toHaveLength(1);
    expect(outputs.every((o) => o.filepath !== ".clineignore")).toBe(true);
  });

  it("should respect baseDir parameter", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });

    const outputs = await generateClineConfig([mockRule], mockConfig, "/custom/base");

    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.filepath).toBe("/custom/base/.clinerules/test-rule.md");
    expect(outputs[1]?.filepath).toBe("/custom/base/.clineignore");
  });
});
