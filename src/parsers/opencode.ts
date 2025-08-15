import type { ParsedRule } from "../types/index.js";
import { parseConfigurationFiles } from "./shared-helpers.js";

export interface OpencodeImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseOpencodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<OpencodeImportResult> {
  return parseConfigurationFiles(baseDir, {
    tool: "opencode",
    mainFile: {
      path: "AGENTS.md",
      useFrontmatter: false,
      description: "SST OpenCode project rules",
      filenameOverride: "AGENTS",
    },
    directories: [],
    errorMessage: "No SST OpenCode configuration files found (AGENTS.md)",
  });
}