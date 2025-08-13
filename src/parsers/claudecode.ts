import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface ClaudeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseClaudeConfiguration(
  baseDir: string = process.cwd(),
): Promise<ClaudeImportResult> {
  return parseMemoryBasedConfiguration(baseDir, {
    tool: "claudecode",
    mainFileName: "CLAUDE.md",
    memoryDirPath: ".claude/memories",
    settingsPath: ".claude/settings.json",
    mainDescription: "Main Claude Code configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "claude",
    commandsDirPath: ".claude/commands",
  });
}
