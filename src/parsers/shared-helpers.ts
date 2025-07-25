import { basename, join } from "node:path";
import matter from "gray-matter";
import type { ParsedRule, RuleFrontmatter, ToolTarget } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface ParserResult {
  rules: ParsedRule[];
  errors: string[];
}

export interface DirectoryConfig {
  directory: string;
  filePattern: string;
  description: string;
}

export interface ParserConfig {
  tool: ToolTarget;
  mainFile?: {
    path: string;
    useFrontmatter?: boolean;
    description: string;
  };
  directories?: DirectoryConfig[];
  errorMessage: string;
}

/**
 * Generic parser for configuration files that follows common patterns
 */
export async function parseConfigurationFiles(
  baseDir: string = process.cwd(),
  config: ParserConfig,
): Promise<ParserResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Parse main configuration file
  if (config.mainFile) {
    const mainFilePath = join(baseDir, config.mainFile.path);
    if (await fileExists(mainFilePath)) {
      try {
        const rawContent = await readFileContent(mainFilePath);
        let content: string;
        let frontmatter: RuleFrontmatter;

        if (config.mainFile.useFrontmatter) {
          const parsed = matter(rawContent);
          content = parsed.content.trim();
          frontmatter = {
            root: false,
            targets: [config.tool],
            description: config.mainFile.description,
            globs: ["**/*"],
          };
        } else {
          content = rawContent.trim();
          frontmatter = {
            root: false,
            targets: [config.tool],
            description: config.mainFile.description,
            globs: ["**/*"],
          };
        }

        if (content) {
          rules.push({
            frontmatter,
            content,
            filename: `${config.tool}-instructions`,
            filepath: mainFilePath,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to parse ${config.mainFile.path}: ${errorMessage}`);
      }
    }
  }

  // Parse directory-based configuration files
  if (config.directories) {
    for (const dirConfig of config.directories) {
      const dirPath = join(baseDir, dirConfig.directory);
      if (await fileExists(dirPath)) {
        try {
          const { readdir } = await import("node:fs/promises");
          const files = await readdir(dirPath);

          for (const file of files) {
            if (file.endsWith(dirConfig.filePattern)) {
              const filePath = join(dirPath, file);
              try {
                const rawContent = await readFileContent(filePath);
                let content: string;

                if (dirConfig.filePattern === ".instructions.md") {
                  // GitHub Copilot style with frontmatter
                  const parsed = matter(rawContent);
                  content = parsed.content.trim();
                } else {
                  content = rawContent.trim();
                }

                if (content) {
                  const filename = file.replace(new RegExp(`\\${dirConfig.filePattern}$`), "");
                  const frontmatter: RuleFrontmatter = {
                    root: false,
                    targets: [config.tool],
                    description: `${dirConfig.description}: ${filename}`,
                    globs: ["**/*"],
                  };

                  rules.push({
                    frontmatter,
                    content,
                    filename: `${config.tool}-${filename}`,
                    filepath: filePath,
                  });
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                errors.push(`Failed to parse ${filePath}: ${errorMessage}`);
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to parse ${dirConfig.directory} files: ${errorMessage}`);
        }
      }
    }
  }

  if (rules.length === 0) {
    errors.push(config.errorMessage);
  }

  return { rules, errors };
}

export interface MemoryBasedParserResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

export interface MemoryBasedConfig {
  tool: ToolTarget;
  mainFileName: string;
  memoryDirPath: string;
  settingsPath: string;
  mainDescription: string;
  memoryDescription: string;
  filenamePrefix: string;
  additionalIgnoreFile?: {
    path: string;
    parser: (filePath: string) => Promise<string[]>;
  };
}

/**
 * Generic parser for memory-based configuration (Claude Code, Gemini CLI)
 */
export async function parseMemoryBasedConfiguration(
  baseDir: string = process.cwd(),
  config: MemoryBasedConfig,
): Promise<MemoryBasedParserResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  // Check for main file (CLAUDE.md or GEMINI.md)
  const mainFilePath = join(baseDir, config.mainFileName);
  if (!(await fileExists(mainFilePath))) {
    errors.push(`${config.mainFileName} file not found`);
    return { rules, errors };
  }

  try {
    const mainContent = await readFileContent(mainFilePath);

    // Parse main file content
    const mainRule = parseMainFile(mainContent, mainFilePath, config);
    if (mainRule) {
      rules.push(mainRule);
    }

    // Parse memory files if they exist
    const memoryDir = join(baseDir, config.memoryDirPath);
    if (await fileExists(memoryDir)) {
      const memoryRules = await parseMemoryFiles(memoryDir, config);
      rules.push(...memoryRules);
    }

    // Parse settings.json if it exists
    const settingsPath = join(baseDir, config.settingsPath);
    if (await fileExists(settingsPath)) {
      const settingsResult = await parseSettingsFile(settingsPath, config.tool);
      if (settingsResult.ignorePatterns) {
        ignorePatterns = settingsResult.ignorePatterns;
      }
      if (settingsResult.mcpServers) {
        mcpServers = settingsResult.mcpServers;
      }
      errors.push(...settingsResult.errors);
    }

    // Parse additional ignore file if specified (e.g., .aiexclude for Gemini)
    if (config.additionalIgnoreFile) {
      const additionalIgnorePath = join(baseDir, config.additionalIgnoreFile.path);
      if (await fileExists(additionalIgnorePath)) {
        const additionalPatterns = await config.additionalIgnoreFile.parser(additionalIgnorePath);
        if (additionalPatterns.length > 0) {
          ignorePatterns = ignorePatterns
            ? [...ignorePatterns, ...additionalPatterns]
            : additionalPatterns;
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse ${config.tool} configuration: ${errorMessage}`);
  }

  return {
    rules,
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}

function parseMainFile(
  content: string,
  filepath: string,
  config: MemoryBasedConfig,
): ParsedRule | null {
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
    targets: [config.tool],
    description: config.mainDescription,
    globs: ["**/*"],
  };

  return {
    frontmatter,
    content: mainContent,
    filename: `${config.filenamePrefix}-main`,
    filepath,
  };
}

async function parseMemoryFiles(
  memoryDir: string,
  config: MemoryBasedConfig,
): Promise<ParsedRule[]> {
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
            targets: [config.tool],
            description: `${config.memoryDescription}: ${filename}`,
            globs: ["**/*"],
          };

          rules.push({
            frontmatter,
            content: content.trim(),
            filename: `${config.filenamePrefix}-memory-${filename}`,
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

interface SettingsResult {
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
  errors: string[];
}

async function parseSettingsFile(settingsPath: string, tool: ToolTarget): Promise<SettingsResult> {
  const errors: string[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  try {
    const content = await readFileContent(settingsPath);
    const settings = JSON.parse(content);

    // Extract ignore patterns from permissions.deny (Claude Code specific)
    if (
      tool === "claudecode" &&
      typeof settings === "object" &&
      settings !== null &&
      "permissions" in settings
    ) {
      const permissions = settings.permissions;
      if (typeof permissions !== "object" || permissions === null) {
        return { ignorePatterns: [], errors: [] };
      }
      if (permissions && "deny" in permissions && Array.isArray(permissions.deny)) {
        const readPatterns = permissions.deny
          .filter(
            (rule: unknown): rule is string =>
              typeof rule === "string" && rule.startsWith("Read(") && rule.endsWith(")"),
          )
          .map((rule: string) => {
            const match = rule.match(/^Read\((.+)\)$/);
            return match ? match[1] : null;
          })
          .filter((pattern: string | null): pattern is string => pattern !== null);

        if (readPatterns.length > 0) {
          ignorePatterns = readPatterns;
        }
      }
    }

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
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}
