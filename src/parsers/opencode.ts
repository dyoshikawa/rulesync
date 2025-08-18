import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { readFileContent } from "../utils/index.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface OpenCodeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

async function parseOpCodeIgnore(opcodeignorePath: string): Promise<string[]> {
  try {
    const content = await readFileContent(opcodeignorePath);
    const patterns = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return patterns;
  } catch {
    return [];
  }
}

export async function parseOpenCodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<OpenCodeImportResult> {
  return parseMemoryBasedConfiguration(baseDir, {
    tool: "opencode",
    mainFileName: "AGENTS.md",
    memoryDirPath: ".opencode/memories",
    settingsPath: "opencode.json",
    mainDescription: "Main OpenCode configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "opencode",
    additionalIgnoreFile: {
      path: ".opcodeignore",
      parser: parseOpCodeIgnore,
    },
  });
}
