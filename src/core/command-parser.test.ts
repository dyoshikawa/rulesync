import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseCommandsFromDirectory } from "./command-parser.js";

describe("parseCommandsFromDirectory", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return empty array for non-existent directory", async () => {
    const nonExistentDir = join(testDir, "nonexistent");

    const result = await parseCommandsFromDirectory(nonExistentDir);

    expect(result).toEqual([]);
  });

  it("should return empty array for empty directory", async () => {
    const emptyDir = join(testDir, "empty");
    await mkdir(emptyDir, { recursive: true });

    const result = await parseCommandsFromDirectory(emptyDir);

    expect(result).toEqual([]);
  });

  it("should parse valid command file", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const commandContent = `---
description: "Code review command"
---

# Code Review

Please review the following code:
{{args}}

Focus on:
1. Code quality
2. Security issues
3. Performance`;

    await writeFile(join(commandsDir, "review.md"), commandContent);

    const result = await parseCommandsFromDirectory(commandsDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: "review",
      frontmatter: {
        description: "Code review command",
      },
      content: expect.stringContaining("# Code Review"),
    });
    expect(result[0]?.filepath).toContain("review.md");
  });

  it("should parse multiple command files", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const reviewCommand = `---
description: "Code review command"
---

# Review
Review code: {{args}}`;

    const analyzeCommand = `---
description: "Code analysis command"
---

# Analyze
Analyze code: {{args}}`;

    const formatCommand = `---
description: "Code formatting command"
---

# Format
Format code: {{args}}`;

    await writeFile(join(commandsDir, "review.md"), reviewCommand);
    await writeFile(join(commandsDir, "analyze.md"), analyzeCommand);
    await writeFile(join(commandsDir, "format.md"), formatCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    expect(result).toHaveLength(3);
    expect(result.map((c) => c.filename)).toContain("review");
    expect(result.map((c) => c.filename)).toContain("analyze");
    expect(result.map((c) => c.filename)).toContain("format");
  });

  it("should handle missing frontmatter", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const invalidCommand = `# No Frontmatter

This command has no frontmatter.`;

    await writeFile(join(commandsDir, "invalid.md"), invalidCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    // Since BaseFrontmatterSchema has optional description, file parses successfully
    // with undefined description
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.description).toBeUndefined();
    expect(result[0]?.content).toContain("# No Frontmatter");
  });

  it("should handle invalid frontmatter", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const invalidCommand = `---
invalid: frontmatter
missing: description
---

# Invalid Frontmatter

This command has invalid frontmatter.`;

    await writeFile(join(commandsDir, "invalid.md"), invalidCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    // BaseFrontmatterSchema only requires optional description,
    // so invalid fields are ignored and file parses successfully
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.description).toBeUndefined();
    expect(result[0]?.content).toContain("# Invalid Frontmatter");
  });

  it("should skip non-markdown files", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const validCommand = `---
description: "Valid command"
---

# Valid Command
Content`;

    await writeFile(join(commandsDir, "valid.md"), validCommand);
    await writeFile(join(commandsDir, "ignored.txt"), "This should be ignored");
    await writeFile(join(commandsDir, "also-ignored.json"), "{}");

    const result = await parseCommandsFromDirectory(commandsDir);

    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe("valid");
  });

  it("should handle commands with complex content", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const complexCommand = `---
description: "Complex command with code examples"
---

# Complex Command

This command has complex content:

\`\`\`typescript
interface User {
  id: string;
  name: string;
}
\`\`\`

Please analyze: {{args}}

## Features
- Code analysis
- Type checking
- Performance review

### Usage
Use this command to review TypeScript code.`;

    await writeFile(join(commandsDir, "complex.md"), complexCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toContain("interface User");
    expect(result[0]?.content).toContain("{{args}}");
    expect(result[0]?.content).toContain("## Features");
  });

  it("should handle empty description", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    const emptyDescCommand = `---
description: ""
---

# Empty Description Command

This command has an empty description.`;

    await writeFile(join(commandsDir, "empty-desc.md"), emptyDescCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.description).toBe("");
  });

  it("should parse commands from nested directories", async () => {
    const commandsDir = join(testDir, "commands");
    const subDir = join(commandsDir, "subdir");
    await mkdir(subDir, { recursive: true });

    const mainCommand = `---
description: "Main command"
---

# Main Command`;

    const subCommand = `---
description: "Sub command"
---

# Sub Command`;

    await writeFile(join(commandsDir, "main.md"), mainCommand);
    await writeFile(join(subDir, "sub.md"), subCommand);

    const result = await parseCommandsFromDirectory(commandsDir);

    // findFiles function only searches at top level, not recursively
    // So we expect only the main.md file to be found
    expect(result).toHaveLength(1);
    expect(result.map((c) => c.filename)).toContain("main");
  });
});
