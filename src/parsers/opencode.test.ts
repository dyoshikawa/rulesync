import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseOpencodeConfiguration } from "./opencode.js";
import { writeFile } from "node:fs/promises";

describe("parseOpencodeConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse AGENTS.md file", async () => {
    const agentsContent = `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types

## Security Guidelines
- Never commit secrets or API keys
- Validate all user inputs`;

    await writeFile(join(testDir, "AGENTS.md"), agentsContent);

    const result = await parseOpencodeConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.filename).toBe("AGENTS");
    expect(result.rules[0]!.content).toBe(agentsContent);
    expect(result.rules[0]!.frontmatter.description).toBe("SST OpenCode project rules");
    expect(result.rules[0]!.frontmatter.targets).toEqual(["opencode"]);
  });

  it("should return error when no AGENTS.md file found", async () => {
    const result = await parseOpencodeConfiguration(testDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("No SST OpenCode configuration files found (AGENTS.md)");
    expect(result.rules).toHaveLength(0);
  });

  it("should parse AGENTS.md with complex content", async () => {
    const agentsContent = `# Advanced OpenCode Rules

## Project Overview
This is a comprehensive TypeScript project with advanced patterns.

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
* Validate all user inputs in generated code`;

    await writeFile(join(testDir, "AGENTS.md"), agentsContent);

    const result = await parseOpencodeConfiguration(testDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.content).toBe(agentsContent);
    expect(result.rules[0]!.frontmatter.description).toBe("SST OpenCode project rules");
  });
});