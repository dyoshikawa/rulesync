import { join } from "node:path";
import type { ParsedRule } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { fileExists, readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
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
  const result = await parseMemoryBasedConfiguration(baseDir, {
    tool: "claudecode",
    mainFileName: "CLAUDE.md",
    memoryDirPath: ".claude/memories",
    settingsPath: ".claude/settings.json",
    mainDescription: "Main Claude Code configuration",
    memoryDescription: "Memory file",
    filenamePrefix: "claude",
    commandsDirPath: ".claude/commands",
  });

  // Parse subagents from .claude/agents directory
  const agentsDir = join(baseDir, ".claude", "agents");
  if (await fileExists(agentsDir)) {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(agentsDir);
      const yamlFiles = files.filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));

      for (const file of yamlFiles) {
        try {
          const filePath = join(agentsDir, file);
          const content = await readFileContent(filePath);

          // Parse YAML frontmatter and content
          const parsed = parseFrontmatter(content);

          const subagentRule: ParsedRule = {
            frontmatter: {
              root: false,
              targets: ["claudecode"],
              description:
                typeof parsed.data.description === "string"
                  ? parsed.data.description
                  : "Imported Claude Code subagent",
              globs: ["**/*"],
            },
            content: parsed.content.trim(),
            filename: file.replace(/\.(yaml|yml)$/, ""),
            filepath: filePath,
            type: "subagent",
          };

          result.rules.push(subagentRule);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to parse subagent file ${file}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to read agents directory: ${errorMessage}`);
    }
  }

  return result;
}
