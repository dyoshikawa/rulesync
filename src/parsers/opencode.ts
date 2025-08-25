import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { fileExists, readFileContent, resolvePath } from "../utils/index.js";
import { parseMemoryBasedConfiguration } from "./shared-helpers.js";

export interface OpenCodeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseOpenCodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<OpenCodeImportResult> {
  const result = await parseMemoryBasedConfiguration(baseDir, {
    tool: "opencode",
    mainFileName: "AGENTS.md",
    memoryDirPath: ".opencode/memories",
    settingsPath: "opencode.json",
    mainDescription: "Main OpenCode configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "opencode",
  });

  // Also parse .opcodeignore file if it exists
  const opcodeignorePath = resolvePath(".opcodeignore", baseDir);
  if (await fileExists(opcodeignorePath)) {
    try {
      const content = await readFileContent(opcodeignorePath);
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      if (patterns.length > 0) {
        // Merge patterns with any existing ones
        if (result.ignorePatterns) {
          result.ignorePatterns = [...result.ignorePatterns, ...patterns];
        } else {
          result.ignorePatterns = patterns;
        }
      }
    } catch {
      // Silently ignore errors reading .opcodeignore
    }
  }

  return result;
}
