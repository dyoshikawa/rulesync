import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { fileExists, readFileContent, resolvePath } from "../utils/index.js";
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

async function parseGeminiCommands(commandsDir: string): Promise<ParsedRule[]> {
  const rules: ParsedRule[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const { parse } = await import("smol-toml");
    const files = await readdir(commandsDir);

    for (const file of files) {
      if (file.endsWith(".toml")) {
        const filePath = join(commandsDir, file);
        const content = await readFileContent(filePath);

        if (content.trim()) {
          const filename = basename(file, ".toml");

          try {
            // Parse TOML using smol-toml
            const parsed = parse(content);

            // Type guard for the expected structure
            if (typeof parsed !== "object" || parsed === null) {
              continue;
            }

            const commandConfig: Record<string, unknown> = parsed;

            // Check if prompt exists and is a string
            if (typeof commandConfig.prompt === "string") {
              const description =
                typeof commandConfig.description === "string"
                  ? commandConfig.description
                  : `Command: ${filename}`;

              const frontmatter: RuleFrontmatter = {
                root: false,
                targets: ["geminicli"],
                description,
                globs: ["**/*"],
              };

              rules.push({
                frontmatter,
                content: commandConfig.prompt,
                filename: filename,
                filepath: filePath,
                type: "command",
              } satisfies ParsedRule);
            }
          } catch {
            // Skip files that can't be parsed as valid TOML
          }
        }
      }
    }
  } catch {
    // Commands files are optional, so we don't throw errors
  }

  return rules;
}

export async function parseGeminiConfiguration(
  baseDir: string = process.cwd(),
): Promise<GeminiImportResult> {
  const result = await parseMemoryBasedConfiguration(baseDir, {
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
    // commandsDirPath is removed - Gemini uses .toml files which need special handling
  });

  // Parse Gemini-specific commands from .toml files
  const commandsDir = resolvePath(".gemini/commands", baseDir);
  if (await fileExists(commandsDir)) {
    const commandsRules = await parseGeminiCommands(commandsDir);
    result.rules.push(...commandsRules);
  }

  return result;
}
