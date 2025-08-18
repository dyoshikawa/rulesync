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

  it("should generate AGENTS.md with XML document references and separate memory files", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(2); // AGENTS.md + component-guidelines.md

    // Check AGENTS.md root file is generated
    const codexFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(codexFile).toBeDefined();
    expect(codexFile?.tool).toBe("codexcli");

    // Should contain XML document references
    expect(codexFile?.content).toContain("Please also reference the following documents as needed");
    expect(codexFile?.content).toContain("<Documents>");
    expect(codexFile?.content).toContain("@.codex/memories/component-guidelines.md");
    expect(codexFile?.content).toContain("Component development guidelines");

    // Should contain root rule content
    expect(codexFile?.content).toContain("# E-commerce Platform");
    expect(codexFile?.content).toContain("## Tech Stack");
    expect(codexFile?.content).toContain("## Coding Standards");

    // Check separate memory file is generated
    const memoryFile = results.find(
      (r) => r.filepath === ".codex/memories/component-guidelines.md",
    );
    expect(memoryFile).toBeDefined();
    expect(memoryFile?.tool).toBe("codexcli");
    expect(memoryFile?.content).toContain("## Component Guidelines");
    expect(memoryFile?.content).toContain("### File Organization");
  });

  it("should generate plain Markdown without frontmatter", async () => {
    const results = await generateCodexConfig(mockRules, mockConfig);

    const codexFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(codexFile).toBeDefined();
    // Should not contain YAML frontmatter (but may contain --- as separator)
    expect(codexFile?.content).not.toContain("targets:");
    expect(codexFile?.content).not.toContain("root:");
    expect(codexFile?.content).not.toContain("description:");
    expect(codexFile?.content).not.toContain("globs:");
  });

  it("should generate separate memory files for non-root rules", async () => {
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

    expect(results).toHaveLength(2); // AGENTS.md + api-guidelines.md

    // Check root file with XML references
    const rootFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(rootFile).toBeDefined();
    expect(rootFile?.content).toContain("<Documents>");
    expect(rootFile?.content).toContain("@.codex/memories/api-guidelines.md");
    expect(rootFile?.content).toContain("API development guidelines");

    // Check separate memory file
    const memoryFile = results.find((r) => r.filepath === ".codex/memories/api-guidelines.md");
    expect(memoryFile).toBeDefined();
    expect(memoryFile?.content).toContain("## API Guidelines");
    expect(memoryFile?.content).toContain("Use RESTful conventions");
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

    expect(results).toHaveLength(1); // Only AGENTS.md
    expect(results[0]?.filepath).toBe("AGENTS.md");
    expect(results[0]?.content).toContain("# Project Instructions");
    expect(results[0]?.content).toContain("## Safety Rules");
    // Should not contain XML references when no memory files exist
    expect(results[0]?.content).not.toContain("<Documents>");
  });

  it("should handle only non-root rules with separate memory files", async () => {
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

    expect(results).toHaveLength(3); // AGENTS.md + 2 memory files

    // Check root file with XML references
    const rootFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(rootFile).toBeDefined();
    expect(rootFile?.content).toContain("<Documents>");
    expect(rootFile?.content).toContain("@.codex/memories/testing-guidelines.md");
    expect(rootFile?.content).toContain("@.codex/memories/deployment-rules.md");

    // Check memory files
    const testingFile = results.find((r) => r.filepath === ".codex/memories/testing-guidelines.md");
    expect(testingFile?.content).toContain("## Testing Guidelines");

    const deploymentFile = results.find(
      (r) => r.filepath === ".codex/memories/deployment-rules.md",
    );
    expect(deploymentFile?.content).toContain("## Deployment Rules");
  });

  it("should generate .codexignore when .rulesyncignore exists", async () => {
    vi.mocked(loadIgnorePatterns).mockResolvedValue({
      patterns: ["*.test.md", "node_modules/**", "temp/**/*"],
    });

    const results = await generateCodexConfig(mockRules, mockConfig);

    expect(results).toHaveLength(3); // AGENTS.md + component-guidelines.md + .codexignore

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

    expect(results).toHaveLength(2); // AGENTS.md + component-guidelines.md
    expect(results.find((r) => r.filepath === `${baseDir}/AGENTS.md`)).toBeDefined();
    expect(
      results.find((r) => r.filepath === `${baseDir}/.codex/memories/component-guidelines.md`),
    ).toBeDefined();
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

    expect(results).toHaveLength(2); // AGENTS.md + testing-setup.md

    const rootFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(rootFile).toBeDefined();

    // Should contain first root rule (only first root rule is used)
    expect(rootFile?.content).toContain("# Project Overview");
    // Should contain XML references to memory files
    expect(rootFile?.content).toContain("@.codex/memories/testing-setup.md");

    // Check memory file
    const memoryFile = results.find((r) => r.filepath === ".codex/memories/testing-setup.md");
    expect(memoryFile?.content).toContain("## Testing Setup");
  });

  it("should handle mixed content with root and memory files", async () => {
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

    expect(results).toHaveLength(3); // AGENTS.md + 2 memory files

    // Check root file
    const rootFile = results.find((r) => r.filepath === "AGENTS.md");
    expect(rootFile).toBeDefined();
    expect(rootFile?.content).toContain("# Main Instructions");
    expect(rootFile?.content).toContain("<Documents>");
    expect(rootFile?.content).toContain("@.codex/memories/api.md");
    expect(rootFile?.content).toContain("@.codex/memories/database.md");

    // Check memory files
    const apiFile = results.find((r) => r.filepath === ".codex/memories/api.md");
    expect(apiFile?.content).toContain("## API Guidelines");

    const databaseFile = results.find((r) => r.filepath === ".codex/memories/database.md");
    expect(databaseFile?.content).toContain("## Database Rules");
  });
});
