import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface AmazonqcliImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseAmazonqcliConfiguration(
  baseDir: string = process.cwd(),
): Promise<AmazonqcliImportResult> {
  return parseMemoryBasedConfiguration(baseDir, {
    tool: "amazonqcli",
    mainFileName: ".amazonq/rules/main.md",
    memoryDirPath: ".amazonq/rules",
    settingsPath: ".amazonq/mcp.json",
    mainDescription: "Main Amazon Q Developer CLI configuration",
    memoryDescription: "Amazon Q rule",
    filenamePrefix: "amazonq",
  });
}
