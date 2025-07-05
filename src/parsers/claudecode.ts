import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface ClaudeImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export async function parseClaudeConfiguration(
  baseDir: string = process.cwd(),
): Promise<ClaudeImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  // Check for CLAUDE.md file
  const claudeFilePath = join(baseDir, "CLAUDE.md");
  if (!(await fileExists(claudeFilePath))) {
    errors.push("CLAUDE.md file not found");
    return { rules, errors };
  }

  try {
    const claudeContent = await readFileContent(claudeFilePath);

    // Parse main CLAUDE.md content
    const mainRule = parseClaudeMainFile(claudeContent, claudeFilePath);
    if (mainRule) {
      rules.push(mainRule);
    }

    // Parse memory files if they exist
    const memoryDir = join(baseDir, ".claude", "memories");
    if (await fileExists(memoryDir)) {
      const memoryRules = await parseClaudeMemoryFiles(memoryDir);
      rules.push(...memoryRules);
    }

    // Parse settings.json if it exists
    const settingsPath = join(baseDir, ".claude", "settings.json");
    if (await fileExists(settingsPath)) {
      const settingsResult = await parseClaudeSettings(settingsPath);
      if (settingsResult.ignorePatterns) {
        ignorePatterns = settingsResult.ignorePatterns;
      }
      if (settingsResult.mcpServers) {
        mcpServers = settingsResult.mcpServers;
      }
      errors.push(...settingsResult.errors);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse Claude configuration: ${errorMessage}`);
  }

  return {
    rules,
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}

function parseClaudeMainFile(content: string, filepath: string): ParsedRule | null {
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
    targets: ["claudecode"],
    description: "Main Claude Code configuration",
    globs: ["**/*"],
  };

  return {
    frontmatter,
    content: mainContent,
    filename: "claude-main",
    filepath,
  };
}

async function parseClaudeMemoryFiles(memoryDir: string): Promise<ParsedRule[]> {
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
            targets: ["claudecode"],
            description: `Memory file: ${filename}`,
            globs: ["**/*"],
          };

          rules.push({
            frontmatter,
            content: content.trim(),
            filename: `claude-memory-${filename}`,
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

interface ClaudeSettingsResult {
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
  errors: string[];
}

async function parseClaudeSettings(settingsPath: string): Promise<ClaudeSettingsResult> {
  const errors: string[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  try {
    const content = await readFileContent(settingsPath);
    const settings = JSON.parse(content);

    // Extract ignore patterns from permissions.deny
    if (typeof settings === "object" && settings !== null && "permissions" in settings) {
      const permissions = settings.permissions;
      if (typeof permissions !== "object" || permissions === null) {
        return { errors };
      }
      const permsObj = permissions as Record<string, unknown>;
      if (permsObj && "deny" in permsObj && Array.isArray(permsObj.deny)) {
        const readPatterns = permsObj.deny
          .filter(
            (rule): rule is string =>
              typeof rule === "string" && rule.startsWith("Read(") && rule.endsWith(")"),
          )
          .map((rule) => {
            const match = rule.match(/^Read\((.+)\)$/);
            return match ? match[1] : null;
          })
          .filter((pattern): pattern is string => pattern !== null);

        if (readPatterns.length > 0) {
          ignorePatterns = readPatterns;
        }
      }
    }

    // Extract MCP servers
    if (typeof settings === "object" && settings !== null && "mcpServers" in settings) {
      const servers = settings.mcpServers;
      if (servers && typeof servers === "object" && Object.keys(servers).length > 0) {
        mcpServers = servers as Record<string, RulesyncMcpServer>;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse settings.json: ${errorMessage}`);
  }

  return {
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}
