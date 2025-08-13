import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { readFileContent } from "../utils/index.js";
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
  return parseMemoryBasedConfiguration(baseDir, {
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
    commandsDirPath: ".gemini/commands",
  });
}
