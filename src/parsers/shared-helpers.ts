import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter, ToolTarget } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { getErrorMessage, safeAsyncOperation } from "../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../utils/file.js";
import { extractArrayField, extractStringField, parseFrontmatter } from "../utils/frontmatter.js";

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
    isRoot?: boolean;
    filenameOverride?: string;
  };
  directories?: DirectoryConfig[];
  ignoreFile?: {
    path: string;
    parser?: (filePath: string) => Promise<string[]>;
  };
  mcpFile?: {
    path: string;
  };
  errorMessage: string;
}

/**
 * Enhanced generic parser for configuration files that follows common patterns
 */
export async function parseConfigurationFiles(
  baseDir: string = process.cwd(),
  config: ParserConfig,
): Promise<ParserResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Parse main configuration file
  if (config.mainFile) {
    const mainFile = config.mainFile;
    const mainFilePath = resolvePath(mainFile.path, baseDir);
    if (await fileExists(mainFilePath)) {
      const result = await safeAsyncOperation(async () => {
        const rawContent = await readFileContent(mainFilePath);
        let content: string;
        let frontmatter: RuleFrontmatter;

        if (mainFile.useFrontmatter) {
          const parsed = parseFrontmatter(rawContent);
          content = parsed.content;
          // Extract additional frontmatter data if present
          frontmatter = {
            root: mainFile.isRoot ?? false,
            targets: [config.tool],
            description: extractStringField(parsed.data, "description", mainFile.description),
            globs: extractArrayField(parsed.data, "globs", ["**/*"]),
          };

          // Add tags only if they exist to avoid empty arrays
          const tags = extractArrayField(parsed.data, "tags");
          if (tags.length > 0) {
            frontmatter.tags = tags;
          }
        } else {
          content = rawContent.trim();
          frontmatter = {
            root: mainFile.isRoot ?? false,
            targets: [config.tool],
            description: mainFile.description,
            globs: ["**/*"],
          };
        }

        if (content) {
          rules.push({
            frontmatter,
            content,
            filename: mainFile.filenameOverride || "instructions",
            filepath: mainFilePath,
          });
        }
      }, `Failed to parse ${mainFile.path}`);

      if (!result.success) {
        errors.push(result.error);
      }
    }
  }

  // Parse directory-based configuration files
  if (config.directories) {
    for (const dirConfig of config.directories) {
      const dirPath = resolvePath(dirConfig.directory, baseDir);
      if (await fileExists(dirPath)) {
        const result = await safeAsyncOperation(async () => {
          const { readdir } = await import("node:fs/promises");
          const files = await readdir(dirPath);

          for (const file of files) {
            if (file.endsWith(dirConfig.filePattern)) {
              const filePath = join(dirPath, file);
              const fileResult = await safeAsyncOperation(async () => {
                const rawContent = await readFileContent(filePath);
                let content: string;
                let frontmatter: RuleFrontmatter;

                const filename = file.replace(new RegExp(`\\${dirConfig.filePattern}$`), "");

                if (dirConfig.filePattern === ".instructions.md") {
                  // GitHub Copilot style with frontmatter
                  const parsed = parseFrontmatter(rawContent);
                  content = parsed.content;
                  frontmatter = {
                    root: false,
                    targets: [config.tool],
                    description: extractStringField(
                      parsed.data,
                      "description",
                      `${dirConfig.description}: ${filename}`,
                    ),
                    globs: extractArrayField(parsed.data, "globs", ["**/*"]),
                  };

                  // Add tags only if they exist to avoid empty arrays
                  const tags = extractArrayField(parsed.data, "tags");
                  if (tags.length > 0) {
                    frontmatter.tags = tags;
                  }
                } else {
                  content = rawContent.trim();
                  frontmatter = {
                    root: false,
                    targets: [config.tool],
                    description: `${dirConfig.description}: ${filename}`,
                    globs: ["**/*"],
                  };
                }

                if (content) {
                  rules.push({
                    frontmatter,
                    content,
                    filename: filename,
                    filepath: filePath,
                  });
                }
              }, `Failed to parse ${filePath}`);

              if (!fileResult.success) {
                errors.push(fileResult.error);
              }
            }
          }
        }, `Failed to parse ${dirConfig.directory} files`);

        if (!result.success) {
          errors.push(result.error);
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
  commandsDirPath?: string;
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
  const mainFilePath = resolvePath(config.mainFileName, baseDir);
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
    const memoryDir = resolvePath(config.memoryDirPath, baseDir);
    if (await fileExists(memoryDir)) {
      const memoryRules = await parseMemoryFiles(memoryDir, config);
      rules.push(...memoryRules);
    }

    // Parse commands files if they exist
    if (config.commandsDirPath) {
      const commandsDir = resolvePath(config.commandsDirPath, baseDir);
      if (await fileExists(commandsDir)) {
        const commandsRules = await parseCommandsFiles(commandsDir, config);
        rules.push(...commandsRules);
      }
    }

    // Parse settings.json if it exists
    const settingsPath = resolvePath(config.settingsPath, baseDir);
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
      const additionalIgnorePath = resolvePath(config.additionalIgnoreFile.path, baseDir);
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
    errors.push(`Failed to parse ${config.tool} configuration: ${getErrorMessage(error)}`);
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
    filename: "main",
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
            filename: filename,
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

async function parseCommandsFiles(
  commandsDir: string,
  config: MemoryBasedConfig,
): Promise<ParsedRule[]> {
  const rules: ParsedRule[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(commandsDir);

    for (const file of files) {
      if (file.endsWith(".md")) {
        const filePath = join(commandsDir, file);
        const content = await readFileContent(filePath);

        if (content.trim()) {
          const filename = basename(file, ".md");
          let frontmatter: RuleFrontmatter;
          let ruleContent: string;

          // Parse frontmatter if it exists
          try {
            const parsed = parseFrontmatter(content);
            ruleContent = parsed.content;
            // Commands use simplified frontmatter with only description and targets
            frontmatter = {
              root: false,
              targets: [config.tool],
              description: extractStringField(parsed.data, "description", `Command: ${filename}`),
              globs: ["**/*"],
            };
          } catch {
            // If frontmatter parsing fails, treat as plain content
            ruleContent = content.trim();
            // Commands use simplified frontmatter with only description and targets
            frontmatter = {
              root: false,
              targets: [config.tool],
              description: `Command: ${filename}`,
              globs: ["**/*"],
            };
          }

          if (ruleContent) {
            rules.push({
              frontmatter,
              content: ruleContent,
              filename: filename,
              filepath: filePath,
              type: "command",
            });
          }
        }
      }
    }
  } catch {
    // Commands files are optional, so we don't throw errors
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
    errors.push(`Failed to parse settings.json: ${getErrorMessage(error)}`);
  }

  return {
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}
