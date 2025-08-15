import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { generateOpencodeConfig } from "./opencode.js";
import type { ParsedRule, Config } from "../../types/index.js";

describe("generateOpencodeConfig", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should generate AGENTS.md file", async () => {
    const rules: ParsedRule[] = [
      {
        filename: "project-rules",
        filepath: "project-rules.md",
        content: `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types

## Security Guidelines
- Never commit secrets or API keys
- Validate all user inputs`,
        frontmatter: {
          description: "Main project rules",
          targets: ["opencode"],
          globs: [],
          root: false,
        },
      },
    ];

    const config: Config = {
      aiRulesDir: ".rulesync",
      watchEnabled: false,
      defaultTargets: ["opencode"],
      outputPaths: {
        augmentcode: ".",
        "augmentcode-legacy": ".",
        claudecode: ".",
        cline: ".",
        codexcli: ".",
        copilot: ".",
        cursor: ".",
        geminicli: ".",
        junie: ".",
        kiro: ".",
        opencode: ".",
        roo: ".",
        windsurf: ".",
      },
    };

    const results = await generateOpencodeConfig(rules, config, testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.tool).toBe("opencode");
    expect(results[0]!.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(results[0]!.content).toBe(rules[0]!.content);
  });

  it("should handle multiple rules by combining into single AGENTS.md", async () => {
    const rules: ParsedRule[] = [
      {
        filename: "coding-standards",
        filepath: "coding-standards.md",
        content: `# Coding Standards
- Use TypeScript strict mode
- Prefer functional components`,
        frontmatter: {
          description: "Coding standards",
          targets: ["opencode"],
          globs: [],
          root: false,
        },
      },
      {
        filename: "security-rules",
        filepath: "security-rules.md",
        content: `# Security Rules
- Never commit API keys
- Validate all inputs`,
        frontmatter: {
          description: "Security guidelines",
          targets: ["opencode"],
          globs: [],
          root: false,
        },
      },
    ];

    const config: Config = {
      aiRulesDir: ".rulesync",
      watchEnabled: false,
      defaultTargets: ["opencode"],
      outputPaths: {
        augmentcode: ".",
        "augmentcode-legacy": ".",
        claudecode: ".",
        cline: ".",
        codexcli: ".",
        copilot: ".",
        cursor: ".",
        geminicli: ".",
        junie: ".",
        kiro: ".",
        opencode: ".",
        roo: ".",
        windsurf: ".",
      },
    };

    const results = await generateOpencodeConfig(rules, config, testDir);

    expect(results).toHaveLength(2);
    
    // Both rules should generate to AGENTS.md
    expect(results[0]!.tool).toBe("opencode");
    expect(results[0]!.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(results[0]!.content).toBe(rules[0]!.content);
    
    expect(results[1]!.tool).toBe("opencode");
    expect(results[1]!.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(results[1]!.content).toBe(rules[1]!.content);
  });

  it("should generate with complex content", async () => {
    const rules: ParsedRule[] = [
      {
        filename: "comprehensive-rules",
        filepath: "comprehensive-rules.md",
        content: `# OpenCode Project Rules

## Project Overview
Brief elevator pitch of what this repo does and the tech stack.

## Coding Conventions
* TypeScript strict mode, ES2022 syntax
* Prefer zod for schema validation
* Run \`pnpm format\` before every commit

## Directory Glossary
- \`apps/…\` — front-end Next.js apps
- \`packages/…\` — shared libs (import as \`@my-app/<pkg>\`)

## AI Guard-rails
* Never change code under \`packages/generated/**\`
* Ask before running shell commands that modify prod data

## Security Guard-rails
* Never modify files in \`secrets/\` or \`.env*\`
* Ask before running \`rm\`, \`mv\`, or destructive commands
* Don't commit API keys or credentials
* Validate all user inputs in generated code`,
        frontmatter: {
          description: "Comprehensive OpenCode rules",
          targets: ["opencode"],
          globs: [],
          root: false,
        },
      },
    ];

    const config: Config = {
      aiRulesDir: ".rulesync",
      watchEnabled: false,
      defaultTargets: ["opencode"],
      outputPaths: {
        augmentcode: ".",
        "augmentcode-legacy": ".",
        claudecode: ".",
        cline: ".",
        codexcli: ".",
        copilot: ".",
        cursor: ".",
        geminicli: ".",
        junie: ".",
        kiro: ".",
        opencode: ".",
        roo: ".",
        windsurf: ".",
      },
    };

    const results = await generateOpencodeConfig(rules, config, testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.tool).toBe("opencode");
    expect(results[0]!.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(results[0]!.content).toBe(rules[0]!.content);
    expect(results[0]!.content).toContain("## Project Overview");
    expect(results[0]!.content).toContain("## AI Guard-rails");
    expect(results[0]!.content).toContain("## Security Guard-rails");
  });
});