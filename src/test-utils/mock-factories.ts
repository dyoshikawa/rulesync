// import { join } from "node:path"; // Removed unused import
import { RulesyncCommand } from "../commands/rulesync-command.js";
import { RulesyncIgnore } from "../ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../mcp/rulesync-mcp.js";
import { RulesyncRule } from "../rules/rulesync-rule.js";
import { RulesyncSubagent } from "../subagents/rulesync-subagent.js";
import { ToolFile } from "../types/tool-file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";

/**
 * Creates a mock RulesyncCommand with all required properties
 */
export function createMockRulesyncCommand(params: {
  testDir: string;
  fileName?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
}): RulesyncCommand {
  const fileName = params.fileName || "test-command.md";
  const content = params.content || "Test command content";
  const frontmatter = {
    targets: ["*" as const],
    description: "Test command",
    ...params.frontmatter,
  };

  const fileContent = stringifyFrontmatter(content, frontmatter);

  return new RulesyncCommand({
    baseDir: params.testDir,
    relativeDirPath: ".rulesync/commands",
    relativeFilePath: fileName,
    fileContent,
    frontmatter,
    body: content,
    validate: false, // Don't validate during test setup
  });
}

/**
 * Creates a mock RulesyncIgnore with all required properties
 */
export function createMockRulesyncIgnore(params: {
  testDir: string;
  fileName?: string;
  content?: string;
}): RulesyncIgnore {
  const fileName = params.fileName || ".rulesyncignore";
  const content = params.content || "node_modules/\n*.log\n";

  return new RulesyncIgnore({
    baseDir: params.testDir,
    relativeDirPath: ".",
    relativeFilePath: fileName,
    fileContent: content,
    validate: false, // Don't validate during test setup
  });
}

/**
 * Creates a mock RulesyncRule with all required properties
 */
export function createMockRulesyncRule(params: {
  testDir: string;
  fileName?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
}): RulesyncRule {
  const fileName = params.fileName || "test-rule.md";
  const content = params.content || "Test rule content";
  const frontmatter = {
    root: false,
    description: "Test rule description",
    targets: ["*" as const],
    globs: [],
    ...params.frontmatter,
  };

  return new RulesyncRule({
    baseDir: params.testDir,
    relativeDirPath: ".rulesync/rules",
    relativeFilePath: fileName,
    frontmatter,
    body: content,
    validate: false, // Don't validate during test setup
  });
}

/**
 * Creates a mock RulesyncSubagent with all required properties
 */
export function createMockRulesyncSubagent(params: {
  testDir: string;
  fileName?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
}): RulesyncSubagent {
  const fileName = params.fileName || "test-subagent.md";
  const content = params.content || "Test subagent content";
  const frontmatter = {
    targets: ["*" as const],
    name: "Test Subagent",
    description: "Test subagent description",
    ...params.frontmatter,
  };

  const fileContent = stringifyFrontmatter(content, frontmatter);

  return new RulesyncSubagent({
    baseDir: params.testDir,
    relativeDirPath: ".rulesync/subagents",
    relativeFilePath: fileName,
    fileContent,
    frontmatter,
    body: content,
    validate: false, // Don't validate during test setup
  });
}

/**
 * Creates a mock RulesyncMcp with all required properties
 */
export function createMockRulesyncMcp(params: {
  testDir: string;
  fileName?: string;
  content?: string;
  jsonData?: Record<string, unknown>;
}): RulesyncMcp {
  const fileName = params.fileName || ".mcp.json";
  const jsonData = params.jsonData || {
    mcpServers: {},
    globalShortcuts: [],
  };
  const content = params.content || JSON.stringify(jsonData, null, 2);

  return new RulesyncMcp({
    baseDir: params.testDir,
    relativeDirPath: ".rulesync",
    relativeFilePath: fileName,
    fileContent: content,
    validate: false, // Don't validate during test setup
  });
}

/**
 * Mock ToolFile class for testing
 */
class MockToolFile extends ToolFile {
  validate() {
    return { success: true as const, error: null };
  }
}

/**
 * Creates a mock ToolFile with all required properties
 */
export function createMockToolFile(overrides: {
  testDir: string;
  filePath: string;
  content: string;
}) {
  // Extract relative path components from the full path
  const basePath = overrides.testDir;
  const fullPath = overrides.filePath;
  const relativePath = fullPath.replace(basePath + "/", "");
  const lastSlashIndex = relativePath.lastIndexOf("/");
  const relativeDirPath = lastSlashIndex >= 0 ? relativePath.substring(0, lastSlashIndex) : "";
  const relativeFilePath =
    lastSlashIndex >= 0 ? relativePath.substring(lastSlashIndex + 1) : relativePath;

  return new MockToolFile({
    baseDir: basePath,
    relativeDirPath,
    relativeFilePath,
    fileContent: overrides.content,
    validate: false, // Don't validate during test setup
  });
}
