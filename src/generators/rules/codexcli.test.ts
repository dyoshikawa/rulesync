import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateCodexConfig } from "./codexcli.js";

vi.mock("../../utils/ignore.js", () => ({
  loadIgnorePatterns: vi.fn(),
}));

const mockConfig = createMockConfig();

const mockRules: ParsedRule[] = [
  {
    filename: "project-instructions",
    filepath: "/path/to/project-instructions.md",
    frontmatter: {
      targets: ["codexcli"],
      root: true,
      description: "Project-level Codex CLI instructions",
      globs: ["**/*.ts", "**/*.js"],
    },
    content: `# E-commerce Platform

This is a modern e-commerce platform built with Next.js and TypeScript.

## Tech Stack
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM

## Coding Standards
1. Use TypeScript strict mode
2. Prefer functional components with hooks
3. Always write unit tests for business logic`,
  },
  {
    filename: "component-guidelines",
    filepath: "/path/to/component-guidelines.md",
    frontmatter: {
      targets: ["codexcli"],
      root: false,
      description: "Component development guidelines",
      globs: ["src/components/**/*.tsx"],
    },
    content: `## Component Guidelines

### File Organization
- One component per file
- Co-locate tests with components
- Use index.js for clean imports

### Component Structure
Use TypeScript interfaces for props and follow atomic design principles.`,
  },
];

describe("generateCodexConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });
  });

  it("should generate single concatenated AGENTS.md file with root rules first", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(1);

    // Check single AGENTS.md file is generated
    const codexFile = results.find((r) => r.filepath === "./AGENTS.md");
    expect(codexFile).toBeDefined();
    expect(codexFile?.tool).toBe("codexcli");

    // Should contain root rule content first
    expect(codexFile?.content).toContain("# E-commerce Platform");
    expect(codexFile?.content).toContain("## Tech Stack");
    expect(codexFile?.content).toContain("## Coding Standards");

    // Should contain detail rule content after separator
    expect(codexFile?.content).toContain("---");
    expect(codexFile?.content).toContain("## Component Guidelines");
    expect(codexFile?.content).toContain("### File Organization");

    // Root rule should appear before detail rule
    const rootIndex = codexFile?.content.indexOf("# E-commerce Platform") ?? -1;
    const detailIndex = codexFile?.content.indexOf("## Component Guidelines") ?? -1;
    expect(rootIndex).toBeLessThan(detailIndex);
  });

  it("should generate plain Markdown without frontmatter", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    const codexFile = results.find((r) => r.filepath === "./AGENTS.md");
    // Should not contain YAML frontmatter (but may contain --- as separator)
    expect(codexFile?.content).not.toContain("targets:");
    expect(codexFile?.content).not.toContain("root:");
    expect(codexFile?.content).not.toContain("description:");
    expect(codexFile?.content).not.toContain("globs:");
  });

  it("should concatenate content without HTML comments in merged file", async () => {
    const nonMainRule: ParsedRule[] = [
      {
        filename: "api-guidelines",
        filepath: "/path/to/api-guidelines.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "API development guidelines",
          globs: ["src/api/**/*.ts"],
        },
        content: "## API Guidelines\n\nUse RESTful conventions.",
      },
    ];

    const results = await generateCodexConfig(nonMainRule, mockConfig);

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain("## API Guidelines");
    expect(results[0]?.content).toContain("Use RESTful conventions");
    expect(results[0]?.filepath).toBe("./AGENTS.md");
    // In concatenated mode, we don't include HTML comments
    expect(results[0]?.content).not.toContain("<!-- API development guidelines -->");
  });

  it("should handle only root rules", async () => {
    const rootOnlyRules: ParsedRule[] = [
      {
        filename: "main-instructions",
        filepath: "/path/to/main-instructions.md",
        frontmatter: {
          targets: ["codexcli"],
          root: true,
          description: "Main instructions",
          globs: ["**/*"],
        },
        content: `# Project Instructions

## Safety Rules
- Always ask for confirmation before running destructive commands
- Never execute rm -rf without explicit user approval`,
      },
    ];

    const results = await generateCodexConfig(rootOnlyRules, mockConfig);

    expect(results).toHaveLength(1);
    expect(results[0]?.filepath).toBe("./AGENTS.md");
    expect(results[0]?.content).toContain("# Project Instructions");
    expect(results[0]?.content).toContain("## Safety Rules");
    // Should not include description comment for "Main instructions"
    expect(results[0]?.content).not.toContain("<!-- Main instructions -->");
  });

  it("should handle only non-root rules in single concatenated file", async () => {
    const nonRootRules: ParsedRule[] = [
      {
        filename: "testing-guidelines",
        filepath: "/path/to/testing-guidelines.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "Testing guidelines",
          globs: ["**/*.test.ts"],
        },
        content: `## Testing Guidelines

Write tests before implementing features (TDD).`,
      },
      {
        filename: "deployment-rules",
        filepath: "/path/to/deployment-rules.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "Deployment rules",
          globs: ["deploy/**/*"],
        },
        content: `## Deployment Rules

Use environment variables for secrets.`,
      },
    ];

    const results = await generateCodexConfig(nonRootRules, mockConfig);

    expect(results).toHaveLength(1);

    const codexFile = results[0];
    expect(codexFile?.filepath).toBe("./AGENTS.md");
    expect(codexFile?.content).toContain("## Testing Guidelines");
    expect(codexFile?.content).toContain("Write tests before implementing features");
    expect(codexFile?.content).toContain("---");
    expect(codexFile?.content).toContain("## Deployment Rules");
    expect(codexFile?.content).toContain("Use environment variables for secrets");
  });

  it("should generate .codexignore when .rulesyncignore exists", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "node_modules/**", "temp/**/*"],
    });

    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2); // 1 concatenated AGENTS.md + 1 .codexignore

    const codexignoreFile = results.find((r) => r.filepath === ".codexignore");
    expect(codexignoreFile).toBeDefined();
    expect(codexignoreFile?.tool).toBe("codexcli");
    expect(codexignoreFile?.content).toContain("# Generated by rulesync from .rulesyncignore");
    expect(codexignoreFile?.content).toContain(
      "# This file is automatically generated. Do not edit manually.",
    );
    expect(codexignoreFile?.content).toContain("*.test.md");
    expect(codexignoreFile?.content).toContain("node_modules/**");
    expect(codexignoreFile?.content).toContain("temp/**/*");
  });

  it("should not generate .codexignore when no ignore patterns exist", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({ patterns: [] });

    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results.every((r) => !r.filepath.endsWith(".codexignore"))).toBe(true);
  });

  it("should respect baseDir parameter", async () => {
    const baseDir = "/custom/project";
    const results = await generateCodexConfig(mockRules, mockConfig, baseDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.filepath).toBe(`${baseDir}/AGENTS.md`);
  });

  it("should respect baseDir parameter for .codexignore", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md"],
    });

    const baseDir = "/custom/project";
    const results = await generateCodexConfig(mockRules, mockConfig, baseDir);

    const codexignoreFile = results.find((r) => r.filepath.endsWith(".codexignore"));
    expect(codexignoreFile?.filepath).toBe(`${baseDir}/.codexignore`);
  });

  it("should handle empty rules array", async () => {
    const results = await generateCodexConfig([], mockConfig);

    expect(results).toHaveLength(0);
  });

  it("should handle empty content gracefully", async () => {
    const emptyRules: ParsedRule[] = [
      {
        filename: "empty-rule",
        filepath: "/path/to/empty-rule.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "Empty rule",
          globs: ["**/*"],
        },
        content: "",
      },
    ];

    const results = await generateCodexConfig(emptyRules, mockConfig);

    expect(results).toHaveLength(0); // Empty content rules are skipped
  });

  it("should handle multiple root rules correctly", async () => {
    const multipleRootRules: ParsedRule[] = [
      {
        filename: "project-overview",
        filepath: "/path/to/project-overview.md",
        frontmatter: {
          targets: ["codexcli"],
          root: true,
          description: "Project overview",
          globs: ["**/*"],
        },
        content: "# Project Overview\n\nThis is the main project.",
      },
      {
        filename: "security-rules",
        filepath: "/path/to/security-rules.md",
        frontmatter: {
          targets: ["codexcli"],
          root: true,
          description: "Security guidelines",
          globs: ["**/*"],
        },
        content: "# Security Guidelines\n\nAlways validate inputs.",
      },
      {
        filename: "testing-setup",
        filepath: "/path/to/testing-setup.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "Testing setup",
          globs: ["**/*.test.ts"],
        },
        content: "## Testing Setup\n\nUse Jest for testing.",
      },
    ];

    const results = await generateCodexConfig(multipleRootRules, mockConfig);

    expect(results).toHaveLength(1);

    const codexFile = results[0];
    expect(codexFile?.filepath).toBe("./AGENTS.md");

    // Should contain all root rules first
    expect(codexFile?.content).toContain("# Project Overview");
    expect(codexFile?.content).toContain("# Security Guidelines");
    expect(codexFile?.content).toContain("## Testing Setup");

    // Root rules should appear before detail rules
    const projectIndex = codexFile?.content.indexOf("# Project Overview") ?? -1;
    const securityIndex = codexFile?.content.indexOf("# Security Guidelines") ?? -1;
    const testingIndex = codexFile?.content.indexOf("## Testing Setup") ?? -1;

    expect(projectIndex).toBeGreaterThanOrEqual(0);
    expect(securityIndex).toBeGreaterThanOrEqual(0);
    expect(testingIndex).toBeGreaterThanOrEqual(0);
    expect(testingIndex).toBeGreaterThan(Math.max(projectIndex, securityIndex));
  });

  it("should handle mixed content with separators", async () => {
    const mixedRules: ParsedRule[] = [
      {
        filename: "main",
        filepath: "/path/to/main.md",
        frontmatter: {
          targets: ["codexcli"],
          root: true,
          description: "Main instructions",
          globs: ["**/*"],
        },
        content: "# Main Instructions\n\nFollow these rules.",
      },
      {
        filename: "api",
        filepath: "/path/to/api.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "API guidelines",
          globs: ["src/api/**/*"],
        },
        content: "## API Guidelines\n\nUse REST conventions.",
      },
      {
        filename: "database",
        filepath: "/path/to/database.md",
        frontmatter: {
          targets: ["codexcli"],
          root: false,
          description: "Database rules",
          globs: ["src/db/**/*"],
        },
        content: "## Database Rules\n\nUse transactions.",
      },
    ];

    const results = await generateCodexConfig(mixedRules, mockConfig);

    expect(results).toHaveLength(1);

    const content = results[0]?.content ?? "";

    // Should have separators between sections
    const separatorCount = (content.match(/^---$/gm) || []).length;
    expect(separatorCount).toBe(2); // Between 3 sections = 2 separators

    // Content should be properly structured
    expect(content).toContain("# Main Instructions");
    expect(content).toContain("## API Guidelines");
    expect(content).toContain("## Database Rules");
  });
});
