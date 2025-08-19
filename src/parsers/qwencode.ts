import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
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
  return parseMemoryBasedConfiguration(baseDir, {
    tool: "qwencode",
    mainFileName: "QWEN.md",
    memoryDirPath: ".qwen/memories",
    settingsPath: ".qwen/settings.json",
    mainDescription: "Main Qwen Code configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "qwen",
    // Qwen Code uses git-aware filtering instead of dedicated ignore files
    // additionalIgnoreFile is omitted
    commandsDirPath: ".qwen/commands",
  });
}
