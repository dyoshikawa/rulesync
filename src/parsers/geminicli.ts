import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface GeminiImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseGeminiConfiguration(
  baseDir: string = process.cwd(),
): Promise<GeminiImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  // Check for GEMINI.md file
  const geminiFilePath = join(baseDir, "GEMINI.md");
  if (!(await fileExists(geminiFilePath))) {
    errors.push("GEMINI.md file not found");
    return { rules, errors };
  }

  try {
    const geminiContent = await readFileContent(geminiFilePath);

    // Parse main GEMINI.md content
    const mainRule = parseGeminiMainFile(geminiContent, geminiFilePath);
    if (mainRule) {
      rules.push(mainRule);
    }

    // Parse memory files if they exist
    const memoryDir = join(baseDir, ".gemini", "memories");
    if (await fileExists(memoryDir)) {
      const memoryRules = await parseGeminiMemoryFiles(memoryDir);
      rules.push(...memoryRules);
    }

    // Parse settings.json if it exists
    const settingsPath = join(baseDir, ".gemini", "settings.json");
    if (await fileExists(settingsPath)) {
      const settingsResult = await parseGeminiSettings(settingsPath);
      if (settingsResult.ignorePatterns) {
        ignorePatterns = settingsResult.ignorePatterns;
      }
      if (settingsResult.mcpServers) {
        mcpServers = settingsResult.mcpServers;
      }
      errors.push(...settingsResult.errors);
    }

    // Check for .aiexclude file
    const aiexcludePath = join(baseDir, ".aiexclude");
    if (await fileExists(aiexcludePath)) {
      const aiexcludePatterns = await parseAiexclude(aiexcludePath);
      if (aiexcludePatterns.length > 0) {
        ignorePatterns = ignorePatterns
          ? [...ignorePatterns, ...aiexcludePatterns]
          : aiexcludePatterns;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse Gemini configuration: ${errorMessage}`);
  }

  return {
    rules,
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}

function parseGeminiMainFile(content: string, filepath: string): ParsedRule | null {
  // Extract the main content, excluding the reference table
  const lines = content.split("\n");
  let contentStartIndex = 0;

  // Skip the reference table if it exists
  if (lines.some((line) => line.includes("| Document | Description | File Patterns |"))) {
    const tableEndIndex = lines.findIndex(
      (line, index) =>
        index > 0 &&
        line.trim() === "" &&
        lines[index - 1]?.includes("|") &&
        !lines[index + 1]?.includes("|"),
    );
    if (tableEndIndex !== -1) {
      contentStartIndex = tableEndIndex + 1;
    }
  }

  const mainContent = lines.slice(contentStartIndex).join("\n").trim();

  if (!mainContent) {
    return null;
  }

  const frontmatter: RuleFrontmatter = {
    root: false,
    targets: ["geminicli"],
    description: "Main Gemini CLI configuration",
    globs: ["**/*"],
  };

  return {
    frontmatter,
    content: mainContent,
    filename: "gemini-main",
    filepath,
  };
}

async function parseGeminiMemoryFiles(memoryDir: string): Promise<ParsedRule[]> {
  const rules: ParsedRule[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(memoryDir);

    for (const file of files) {
      if (file.endsWith(".md")) {
        const filePath = join(memoryDir, file);
        const content = await readFileContent(filePath);

        if (content.trim()) {
          const filename = basename(file, ".md");
          const frontmatter: RuleFrontmatter = {
            root: false,
            targets: ["geminicli"],
            description: `Memory file: ${filename}`,
            globs: ["**/*"],
          };

          rules.push({
            frontmatter,
            content: content.trim(),
            filename: `gemini-memory-${filename}`,
            filepath: filePath,
          });
        }
      }
    }
  } catch {
    // Silently handle directory reading errors
  }

  return rules;
}

interface GeminiSettingsResult {
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
  errors: string[];
}

async function parseGeminiSettings(settingsPath: string): Promise<GeminiSettingsResult> {
  const errors: string[] = [];
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  try {
    const content = await readFileContent(settingsPath);
    const settings = JSON.parse(content);

    // Extract MCP servers
    const parseResult = RulesyncMcpConfigSchema.safeParse(settings);
    if (parseResult.success && Object.keys(parseResult.data.mcpServers).length > 0) {
      mcpServers = parseResult.data.mcpServers;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse settings.json: ${errorMessage}`);
  }

  return {
    errors,
    ...(mcpServers && { mcpServers }),
  };
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
