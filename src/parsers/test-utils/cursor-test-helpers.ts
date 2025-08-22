/**
 * Shared test utilities for cursor parser tests
 */
import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface TestFileSpec {
  filename: string;
  content: string;
  directory?: string;
}

/**
 * Create cursor configuration files for testing
 */
export async function createCursorTestFiles(baseDir: string, files: TestFileSpec[]): Promise<void> {
  for (const file of files) {
    const dir = file.directory ? join(baseDir, file.directory) : baseDir;
    await mkdir(dir, { recursive: true });
    writeFileSync(join(dir, file.filename), file.content);
  }
}

/**
 * Create .cursor/rules directory with MDC files
 */
export async function createCursorRulesFiles(
  baseDir: string,
  files: TestFileSpec[],
): Promise<void> {
  const rulesDir = join(baseDir, ".cursor", "rules");
  await mkdir(rulesDir, { recursive: true });

  for (const file of files) {
    writeFileSync(join(rulesDir, file.filename), file.content);
  }
}

/**
 * Standard MDC content templates for testing
 */
export const MDC_TEMPLATES = {
  always: `---
description: Always apply rule
globs: "**/*"
alwaysApply: true
---

# Always Applied Rule
This rule is always applied.`,

  manual: `---
description: 
globs: 
alwaysApply: false
---

# Manual Rule
This rule requires manual application.`,

  specificFiles: `---
description: 
globs: "**/*.ts"
alwaysApply: false
---

# Specific Files Rule
This rule applies to TypeScript files.`,

  intelligently: `---
description: Smart rule application
globs: 
alwaysApply: false
---

# Intelligent Rule
This rule is applied intelligently.`,

  minimal: `# Minimal Rule
Simple rule without frontmatter.`,
} as const;

/**
 * Standard ignore file content
 */
export const IGNORE_CONTENT = `# Generated ignore patterns
node_modules/
*.log
.env
`;

/**
 * Standard MCP configuration
 */
export const MCP_CONFIG = {
  mcpServers: {
    "test-server": {
      command: "node",
      args: ["server.js"],
      env: {
        NODE_ENV: "test",
      },
    },
  },
};
