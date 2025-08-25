import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { readFileContent } from "../utils/file.js";
import { getCommandParser } from "./commands/index.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface GeminiImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

async function parseAiexclude(aiexcludePath: string): Promise<string[]> {
  try {
    const content = await readFileContent(aiexcludePath);
    const patterns = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return patterns;
  } catch {
    return [];
  }
}

export async function parseGeminiConfiguration(
  baseDir: string = process.cwd(),
): Promise<GeminiImportResult> {
  const memoryResult = await parseMemoryBasedConfiguration(baseDir, {
    tool: "geminicli",
    mainFileName: "GEMINI.md",
    memoryDirPath: ".gemini/memories",
    settingsPath: ".gemini/settings.json",
    mainDescription: "Main Gemini CLI configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "gemini",
    additionalIgnoreFile: {
      path: ".aiexclude",
      parser: parseAiexclude,
    },
    // commandsDirPath is removed - now using dedicated command parser
  });

  // Create the result with proper typing
  const result: GeminiImportResult = {
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
  const commandParser = getCommandParser("geminicli");
  if (commandParser) {
    const commands = await commandParser.parseCommands(baseDir);
    // Add commands to rules array since they are rules with type="command"
    result.rules.push(...commands);
  }

  return result;
}
