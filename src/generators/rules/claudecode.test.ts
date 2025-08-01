import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedRule } from "../../types/index.js";
import { getDefaultConfig } from "../../utils/config.js";
import { fileExists, readFileContent, resolvePath, writeFileContent } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateClaudecodeConfig } from "./claudecode.js";

vi.mock("../../utils/ignore.js", () => ({
  loadIgnorePatterns: vi.fn(),
}));

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  ensureDir: vi.fn(),
  resolvePath: vi.fn(),
}));

describe("claudecode generator", () => {
  const config = getDefaultConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });
    vi.mocked(resolvePath).mockImplementation((path: string, baseDir?: string) =>
      baseDir ? `${baseDir}/${path}` : path,
    );
  });

  const mockRules: ParsedRule[] = [
    {
      frontmatter: {
        root: true,
        targets: ["claudecode"],
        description: "Overview coding rule",
        globs: ["**/*.ts"],
      },
      content: "Use TypeScript for all new code.",
      filename: "typescript-rule",
      filepath: "/test/typescript-rule.md",
    },
    {
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Detail architecture rule",
        globs: ["**/*.tsx"],
      },
      content: "Follow clean architecture principles.",
      filename: "architecture-rule",
      filepath: "/test/architecture-rule.md",
    },
    {
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Detail naming rule",
        globs: ["**/*.js"],
      },
      content: "Use camelCase for variables.",
      filename: "naming-rule",
      filepath: "/test/naming-rule.md",
    },
  ];

  it("should generate claudecode configuration", async () => {
    const outputs = await generateClaudecodeConfig(mockRules, config);

    expect(outputs).toHaveLength(3); // 2 detail memory files + 1 main file

    // Check detail files are generated first
    expect(outputs[0]!.tool).toBe("claudecode");
    expect(outputs[0]!.filepath).toBe(".claude/memories/architecture-rule.md");
    expect(outputs[1]!.tool).toBe("claudecode");
    expect(outputs[1]!.filepath).toBe(".claude/memories/naming-rule.md");

    // Check main CLAUDE.md file (should be last)
    const mainFile = outputs[2]!;
    expect(mainFile.tool).toBe("claudecode");
    expect(mainFile.filepath).toBe("CLAUDE.md");
    expect(mainFile.content).not.toContain("# Claude Code Memory - Project Instructions");
    expect(mainFile.content).not.toContain("Generated from rulesync configuration");
    expect(mainFile.content).toContain("Please also reference the following documents as needed:");
    expect(mainFile.content).toContain(
      '@.claude/memories/architecture-rule.md description: "Detail architecture rule" globs: "**/*.tsx"',
    );
    expect(mainFile.content).toContain(
      '@.claude/memories/naming-rule.md description: "Detail naming rule" globs: "**/*.js"',
    );
  });

  it("should separate overview and detail rules", async () => {
    const outputs = await generateClaudecodeConfig(mockRules, config);

    // Main CLAUDE.md should contain overview rules and memory references (at index 2)
    const mainFile = outputs[2]!;
    expect(mainFile.content).toContain("Use TypeScript for all new code.");
    expect(mainFile.content).toContain("Please also reference the following documents as needed:");
    expect(mainFile.content).toContain(
      '@.claude/memories/architecture-rule.md description: "Detail architecture rule" globs: "**/*.tsx"',
    );
    expect(mainFile.content).toContain(
      '@.claude/memories/naming-rule.md description: "Detail naming rule" globs: "**/*.js"',
    );

    // Detail rules should be in separate memory files
    expect(outputs[0]!.filepath).toBe(".claude/memories/architecture-rule.md");
    expect(outputs[1]!.filepath).toBe(".claude/memories/naming-rule.md");
  });

  it("should include rule metadata", async () => {
    const outputs = await generateClaudecodeConfig([mockRules[0]!], config);

    expect(outputs[0]!.content).not.toContain("### Overview coding rule");
    expect(outputs[0]!.content).toContain("Use TypeScript for all new code.");
  });

  it("should handle rules without description", async () => {
    const ruleWithoutDescription: ParsedRule = {
      frontmatter: {
        root: true,
        targets: ["claudecode"],
        description: "",
        globs: [],
      },
      content: "Some rule content.",
      filename: "test-rule",
      filepath: "/test/test-rule.md",
    };

    const outputs = await generateClaudecodeConfig([ruleWithoutDescription], config);

    expect(outputs[0]!.content).not.toContain("### Test rule");
    expect(outputs[0]!.content).toContain("Some rule content.");
  });

  it("should handle rules without globs", async () => {
    const ruleWithoutGlobs: ParsedRule = {
      frontmatter: {
        root: true,
        targets: ["claudecode"],
        description: "Test rule",
        globs: [],
      },
      content: "Some rule content.",
      filename: "test-rule",
      filepath: "/test/test-rule.md",
    };

    const outputs = await generateClaudecodeConfig([ruleWithoutGlobs], config);

    expect(outputs[0]!.content).toContain("Some rule content.");
  });

  it("should handle empty rules array", async () => {
    const outputs = await generateClaudecodeConfig([], config);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content).not.toContain("# Claude Code Memory - Project Instructions");
    expect(outputs[0]!.content).not.toContain("@");
  });

  it("should generate memory files for detail rules", async () => {
    const outputs = await generateClaudecodeConfig(mockRules, config);

    // Should have memory files for detail rules
    const architectureMemory = outputs.find((o) => o.filepath.includes("architecture-rule.md"));
    const namingMemory = outputs.find((o) => o.filepath.includes("naming-rule.md"));

    expect(architectureMemory).toBeDefined();
    expect(architectureMemory?.content).toContain("Follow clean architecture principles.");

    expect(namingMemory).toBeDefined();
    expect(namingMemory?.content).toContain("Use camelCase for variables.");
  });

  it("should update settings.json when .rulesyncignore exists", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "temp/**/*"],
    });
    vi.mocked(fileExists).mockResolvedValue(false);

    await generateClaudecodeConfig(mockRules, config);

    expect(writeFileContent).toHaveBeenCalledWith(
      ".claude/settings.json",
      expect.stringContaining('"Read(*.test.md)"'),
    );
    expect(writeFileContent).toHaveBeenCalledWith(
      ".claude/settings.json",
      expect.stringContaining('"Read(temp/**/*)"'),
    );
  });

  it("should merge with existing settings.json", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue(
      JSON.stringify({
        permissions: {
          deny: ["Bash(sudo:*)"],
        },
      }),
    );

    await generateClaudecodeConfig(mockRules, config);

    const callArgs = vi.mocked(writeFileContent).mock.calls[0];
    const settingsContent = JSON.parse(callArgs?.[1] ?? "");

    expect(settingsContent.permissions.deny).toContain("Bash(sudo:*)");
    expect(settingsContent.permissions.deny).toContain("Read(*.test.md)");
  });

  it("should not update settings.json when no ignore patterns exist", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

    await generateClaudecodeConfig(mockRules, config);

    expect(writeFileContent).not.toHaveBeenCalledWith(
      expect.stringContaining("settings.json"),
      expect.any(String),
    );
  });

  it("should respect baseDir parameter for settings.json", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });
    vi.mocked(fileExists).mockResolvedValue(false);

    await generateClaudecodeConfig(mockRules, config, "/custom/base");

    expect(writeFileContent).toHaveBeenCalledWith(
      "/custom/base/.claude/settings.json",
      expect.stringContaining('"Read(*.test.md)"'),
    );
  });

  it("should preserve existing settings outside of permissions.deny", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue(
      JSON.stringify({
        permissions: {
          deny: ["Bash(sudo:*)"],
          allow: ["Read(*.ts)", "Write(*.js)"],
          defaultMode: "acceptEdits",
        },
        customSetting: "value",
        anotherSetting: {
          nested: "property",
        },
      }),
    );

    await generateClaudecodeConfig(mockRules, config);

    const callArgs = vi
      .mocked(writeFileContent)
      .mock.calls.find((call) => call?.[0]?.includes("settings.json"));
    const settingsContent = JSON.parse(callArgs?.[1] ?? "");

    // Check that deny array is updated with our new patterns
    expect(settingsContent.permissions.deny).toContain("Bash(sudo:*)");
    expect(settingsContent.permissions.deny).toContain("Read(*.test.md)");

    // Check that other permissions properties are preserved
    expect(settingsContent.permissions.allow).toEqual(["Read(*.ts)", "Write(*.js)"]);
    expect(settingsContent.permissions.defaultMode).toBe("acceptEdits");

    // Check that root-level custom settings are preserved
    expect(settingsContent.customSetting).toBe("value");
    expect(settingsContent.anotherSetting).toEqual({
      nested: "property",
    });
  });

  it("should handle settings.json without permissions.deny", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue(
      JSON.stringify({
        permissions: {
          allow: ["Read(*.ts)", "Write(*.js)"],
          defaultMode: "acceptEdits",
        },
        customSetting: "value",
      }),
    );

    await generateClaudecodeConfig(mockRules, config);

    const callArgs = vi
      .mocked(writeFileContent)
      .mock.calls.find((call) => call?.[0]?.includes("settings.json"));
    const settingsContent = JSON.parse(callArgs?.[1] ?? "");

    // Check that deny array is created with our patterns
    expect(settingsContent.permissions.deny).toContain("Read(*.test.md)");

    // Check that other permissions properties are preserved
    expect(settingsContent.permissions.allow).toEqual(["Read(*.ts)", "Write(*.js)"]);
    expect(settingsContent.permissions.defaultMode).toBe("acceptEdits");

    // Check that root-level custom settings are preserved
    expect(settingsContent.customSetting).toBe("value");
  });

  it("should handle settings.json without permissions object", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue(
      JSON.stringify({
        customSetting: "value",
        anotherSetting: {
          nested: "property",
        },
      }),
    );

    await generateClaudecodeConfig(mockRules, config);

    const callArgs = vi
      .mocked(writeFileContent)
      .mock.calls.find((call) => call?.[0]?.includes("settings.json"));
    const settingsContent = JSON.parse(callArgs?.[1] ?? "");

    // Check that permissions object is created with deny array
    expect(settingsContent.permissions.deny).toContain("Read(*.test.md)");

    // Check that root-level custom settings are preserved
    expect(settingsContent.customSetting).toBe("value");
    expect(settingsContent.anotherSetting).toEqual({
      nested: "property",
    });
  });

  it("should escape double quotes in descriptions", async () => {
    const ruleWithQuotes: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: 'Rule with "double quotes" in description',
        globs: ["**/*.ts"],
      },
      content: "Some rule content.",
      filename: "quoted-rule",
      filepath: "/test/quoted-rule.md",
    };

    const outputs = await generateClaudecodeConfig([ruleWithQuotes], config);

    expect(outputs[1]!.content).toContain(
      '@.claude/memories/quoted-rule.md description: "Rule with \\"double quotes\\" in description" globs: "**/*.ts"',
    );
  });

  it("should join multiple globs with comma without space", async () => {
    const ruleWithMultipleGlobs: ParsedRule = {
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Rule with multiple globs",
        globs: ["**/*.ts", "**/*.tsx", "src/**/*.js"],
      },
      content: "Some rule content.",
      filename: "multi-glob-rule",
      filepath: "/test/multi-glob-rule.md",
    };

    const outputs = await generateClaudecodeConfig([ruleWithMultipleGlobs], config);

    expect(outputs[1]!.content).toContain(
      '@.claude/memories/multi-glob-rule.md description: "Rule with multiple globs" globs: "**/*.ts,**/*.tsx,src/**/*.js"',
    );
  });
});
