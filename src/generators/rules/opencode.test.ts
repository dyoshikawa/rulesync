import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateOpenCodeConfig } from "./opencode.js";

vi.mock("../../utils/ignore.js", () => ({
  loadIgnorePatterns: vi.fn(),
}));

const mockConfig = createMockConfig();

const mockRules: ParsedRule[] = [
  {
    filename: "overview-rule",
    filepath: "/path/to/overview-rule.md",
    frontmatter: {
      targets: ["*"],
      root: true,
      description: "Overview rule",
      globs: ["**/*.ts", "**/*.js"],
    },
    content: "This is an overview rule content",
  },
  {
    filename: "detail-rule",
    filepath: "/path/to/detail-rule.md",
    frontmatter: {
      targets: ["opencode"],
      root: false,
      description: "Detail rule",
      globs: ["**/*.md"],
    },
    content: "This is a detail rule content",
  },
];

describe("generateOpenCodeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });
  });

  it("should generate AGENTS.md root file and memory files", async () => {
    const results = await generateOpenCodeConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2);

    // Check memory file
    expect(results[0]?.tool).toBe("opencode");
    expect(results[0]?.filepath).toBe(".opencode/memories/detail-rule.md");
    expect(results[0]?.content).not.toContain("# Detail rule");
    expect(results[0]?.content).toContain("This is a detail rule content");

    // Check root file
    expect(results[1]?.tool).toBe("opencode");
    expect(results[1]?.filepath).toBe("AGENTS.md");
    expect(results[1]?.content).toContain(
      "Please also reference the following documents as needed",
    );
    expect(results[1]?.content).toContain("<Documents>");
    expect(results[1]?.content).toContain("<Path>@.opencode/memories/detail-rule.md</Path>");
    expect(results[1]?.content).toContain("This is an overview rule content");
  });

  it("should generate XML format for memory files in root file", async () => {
    const results = await generateOpenCodeConfig(mockRules, mockConfig);
    const rootFile = results.find((r) => r.filepath === "AGENTS.md");

    expect(rootFile?.content).toContain("<Documents>");
    expect(rootFile?.content).toContain("<Path>@.opencode/memories/detail-rule.md</Path>");
    expect(rootFile?.content).toContain("<Description>Detail rule</Description>");
    expect(rootFile?.content).toContain("<FilePatterns>**/*.md</FilePatterns>");
  });

  it("should handle only root rule", async () => {
    const rootOnlyRules: ParsedRule[] = [
      {
        filename: "root-only",
        filepath: "/path/to/root-only.md",
        frontmatter: {
          targets: ["opencode"],
          root: true,
          description: "Root only rule",
          globs: ["**/*.ts"],
        },
        content: "This is root only content",
      },
    ];

    const results = await generateOpenCodeConfig(rootOnlyRules, mockConfig);

    expect(results).toHaveLength(1);
    expect(results[0]!.filepath).toBe("AGENTS.md");
    expect(results[0]!.content).toContain("This is root only content");
    expect(results[0]!.content).not.toContain(
      "Please also reference the following documents as needed:",
    );
  });

  it("should handle only memory rules", async () => {
    const memoryOnlyRules: ParsedRule[] = [
      {
        filename: "memory-rule",
        filepath: "/path/to/memory-rule.md",
        frontmatter: {
          targets: ["opencode"],
          root: false,
          description: "Memory rule",
          globs: ["**/*.ts"],
        },
        content: "This is memory rule content",
      },
    ];

    const results = await generateOpenCodeConfig(memoryOnlyRules, mockConfig);

    expect(results).toHaveLength(2);

    // Memory file
    expect(results[0]!.filepath).toBe(".opencode/memories/memory-rule.md");
    expect(results[0]!.content).not.toContain("# Memory rule");

    // Root file
    expect(results[1]!.filepath).toBe("AGENTS.md");
    expect(results[1]!.content).toContain(
      "Please also reference the following documents as needed",
    );
    expect(results[1]!.content).toContain("<Documents>");
    expect(results[1]!.content).not.toContain("This is memory rule content");
  });

  it("should handle empty rules array", async () => {
    const results = await generateOpenCodeConfig([], mockConfig);

    expect(results).toHaveLength(1);
    expect(results[0]!.filepath).toBe("AGENTS.md");
    expect(results[0]!.content).toContain("No configuration rules have been defined yet");
  });

  it("should not generate .opcodeignore files (OpenCode uses .gitignore instead)", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "temp/**/*"],
    });

    const results = await generateOpenCodeConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2); // 1 memory + 1 root (no .opcodeignore)

    const opcodeIgnoreFile = results.find((r) => r.filepath === ".opcodeignore");
    expect(opcodeIgnoreFile).toBeUndefined();
  });

  it("should not generate .opcodeignore when no ignore patterns exist", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

    const results = await generateOpenCodeConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2); // 1 memory + 1 root
    expect(results.every((r) => r.filepath !== ".opcodeignore")).toBe(true);
  });

  it("should respect baseDir parameter", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });

    const results = await generateOpenCodeConfig(mockRules, mockConfig, "/custom/base");

    expect(results).toHaveLength(2); // 1 memory + 1 root
    expect(results.every((r) => !r.filepath.endsWith(".opcodeignore"))).toBe(true);
  });

  it("should use baseDir when provided", async () => {
    const results = await generateOpenCodeConfig(mockRules, mockConfig, "/custom/base");

    expect(results).toHaveLength(2);
    expect(results[0]!.filepath).toBe("/custom/base/.opencode/memories/detail-rule.md");
    expect(results[1]!.filepath).toBe("/custom/base/AGENTS.md");
  });
});
