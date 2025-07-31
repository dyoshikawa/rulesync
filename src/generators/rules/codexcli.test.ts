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

  it("should generate codex.md for root rules and separate .md files for non-root rules", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2);

    // Check root rule generates codex.md
    const rootFile = results.find((r) => r.filepath === "./codex.md");
    expect(rootFile).toBeDefined();
    expect(rootFile?.tool).toBe("codexcli");
    expect(rootFile?.content).toContain("# E-commerce Platform");
    expect(rootFile?.content).toContain("## Tech Stack");
    expect(rootFile?.content).toContain("## Coding Standards");
    // Should not contain description comment for main instructions
    expect(rootFile?.content).not.toContain("<!-- Project-level Codex CLI instructions -->");

    // Check non-root rule generates separate file
    const componentFile = results.find((r) => r.filepath === "./component-guidelines.md");
    expect(componentFile).toBeDefined();
    expect(componentFile?.tool).toBe("codexcli");
    expect(componentFile?.content).toContain("<!-- Component development guidelines -->");
    expect(componentFile?.content).toContain("## Component Guidelines");
    expect(componentFile?.content).toContain("### File Organization");
  });

  it("should generate plain Markdown without frontmatter", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    const rootFile = results.find((r) => r.filepath === "./codex.md");
    expect(rootFile?.content).not.toContain("---");
    expect(rootFile?.content).not.toContain("targets:");
    expect(rootFile?.content).not.toContain("root:");
    expect(rootFile?.content).not.toContain("description:");
    expect(rootFile?.content).not.toContain("globs:");
  });

  it("should include description as HTML comment for non-main rules", async () => {
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
    expect(results[0]?.content).toContain("<!-- API development guidelines -->");
    expect(results[0]?.content).toContain("## API Guidelines");
    expect(results[0]?.filepath).toBe("./api-guidelines.md");
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
    expect(results[0]?.filepath).toBe("./codex.md");
    expect(results[0]?.content).toContain("# Project Instructions");
    expect(results[0]?.content).toContain("## Safety Rules");
    // Should not include description comment for "Main instructions"
    expect(results[0]?.content).not.toContain("<!-- Main instructions -->");
  });

  it("should handle only non-root rules", async () => {
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

    expect(results).toHaveLength(2);

    const testingFile = results.find((r) => r.filepath === "./testing-guidelines.md");
    expect(testingFile?.content).toContain("<!-- Testing guidelines -->");
    expect(testingFile?.content).toContain("## Testing Guidelines");

    const deploymentFile = results.find((r) => r.filepath === "./deployment-rules.md");
    expect(deploymentFile?.content).toContain("<!-- Deployment rules -->");
    expect(deploymentFile?.content).toContain("## Deployment Rules");
  });

  it("should generate .codexignore when .rulesyncignore exists", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "node_modules/**", "temp/**/*"],
    });

    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(3); // 2 rules + 1 .codexignore

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

    expect(results).toHaveLength(2);
    expect(results[0]?.filepath).toBe(`${baseDir}/codex.md`);
    expect(results[1]?.filepath).toBe(`${baseDir}/component-guidelines.md`);
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

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe("<!-- Empty rule -->");
  });
});
