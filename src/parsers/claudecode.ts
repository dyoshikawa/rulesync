import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import type { ParsedSubagent } from "../types/subagent.js";
import { fileExists, resolvePath } from "../utils/file.js";
import { getCommandParser } from "./commands/index.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";
import { parseSubagentsFromDirectory } from "./subagents/shared.js";

export interface ClaudeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
  subagents?: ParsedSubagent[];
}

export async function parseClaudeConfiguration(
  baseDir: string = process.cwd(),
): Promise<ClaudeImportResult> {
  const memoryResult = await parseMemoryBasedConfiguration(baseDir, {
    tool: "claudecode",
    mainFileName: "CLAUDE.md",
    memoryDirPath: ".claude/memories",
    settingsPath: ".claude/settings.json",
    mainDescription: "Main Claude Code configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "claude",
    // commandsDirPath removed - now using dedicated command parser
  });

  // Create the result with proper typing
  const result: ClaudeImportResult = {
    rules: memoryResult.rules,
    errors: memoryResult.errors,
  };

  // Add optional fields if they exist
  if (memoryResult.ignorePatterns) {
    result.ignorePatterns = memoryResult.ignorePatterns;
  }
  if (memoryResult.mcpServers) {
    result.mcpServers = memoryResult.mcpServers;
  }

  // Parse subagents if they exist
  const agentsDir = resolvePath(".claude/agents", baseDir);
  if (await fileExists(agentsDir)) {
    const subagents = await parseSubagentsFromDirectory(agentsDir);
    if (subagents.length > 0) {
      result.subagents = subagents;
    }
  }

  // Parse commands using the new command parser
  const commandParser = getCommandParser("claudecode");
  if (commandParser) {
    const commands = await commandParser.parseCommands(baseDir);
    // Add commands to rules array since they are rules with type="command"
    result.rules.push(...commands);
  }

  return result;
}
