import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { getCommandParser } from "./commands/index.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface QwenImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseQwenConfiguration(
  baseDir: string = process.cwd(),
): Promise<QwenImportResult> {
  const memoryResult = await parseMemoryBasedConfiguration(baseDir, {
    tool: "qwencode",
    mainFileName: "QWEN.md",
    memoryDirPath: ".qwen/memories",
    settingsPath: ".qwen/settings.json",
    mainDescription: "Main Qwen Code configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "qwen",
    // Qwen Code uses git-aware filtering instead of dedicated ignore files
    // additionalIgnoreFile is omitted
    // commandsDirPath removed - now using dedicated command parser
  });

  // Create the result with proper typing
  const result: QwenImportResult = {
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

  // Parse commands using the new command parser
  const commandParser = getCommandParser("qwencode");
  if (commandParser) {
    const commands = await commandParser.parseCommands(baseDir);
    // Add commands to rules array since they are rules with type="command"
    result.rules.push(...commands);
  }

  return result;
}
