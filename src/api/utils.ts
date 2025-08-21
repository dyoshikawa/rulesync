import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import type { Config as RulesyncConfig } from "../types/index.js";
import { ALL_TOOL_TARGETS } from "../types/tool-targets.js";
// Import utilities
import { loadConfig as loadConfigUtil } from "../utils/config-loader.js";
// Import errors
import { ConfigError, IOError, ParseError as ParseErrorClass } from "./errors.js";
// Import types
import type {
  LoadConfigOptions,
  ParsedRule,
  ParsedRules,
  ParseError,
  ParseRulesOptions,
  ToolInfo,
} from "./types.js";

// ============================================================================
// Parse Rules Function
// ============================================================================

/**
 * Parse rule files from the project
 */
export async function parseRules(options: ParseRulesOptions = {}): Promise<ParsedRules> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();
    const rules: ParsedRule[] = [];
    const errors: ParseError[] = [];

    if (options.filePaths) {
      // Parse specific files
      for (const filePath of options.filePaths) {
        try {
          const absolutePath = resolve(baseDir, filePath);
          const parsedRule = await parseRuleFile(absolutePath);
          if (parsedRule) {
            rules.push(parsedRule);
          }
        } catch (error) {
          errors.push({
            filePath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      // Parse all rule files in the project
      const ruleFiles = await findRuleFiles(baseDir);

      for (const filePath of ruleFiles) {
        try {
          const parsedRule = await parseRuleFile(filePath);
          if (parsedRule) {
            rules.push(parsedRule);
          }
        } catch (error) {
          errors.push({
            filePath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { rules, errors };
  } catch (error) {
    throw new ParseErrorClass(
      `Failed to parse rules: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Load Config Function
// ============================================================================

/**
 * Load rulesync configuration file
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<RulesyncConfig> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();

    const configLoaderOptions: Record<string, unknown> = {};
    if (options.configPath) {
      configLoaderOptions.configPath = options.configPath;
    }
    configLoaderOptions.cwd = baseDir;

    const configResult = await loadConfigUtil(configLoaderOptions);

    let config = configResult.config;

    // Merge with defaults if requested
    if (options.mergeDefaults !== false) {
      const defaultConfig: Partial<RulesyncConfig> = {
        aiRulesDir: ".rulesync",
        legacy: false,
      };

      config = {
        ...defaultConfig,
        ...config,
      };
    }

    return config;
  } catch (error) {
    throw new ConfigError(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Get Supported Tools Function
// ============================================================================

/**
 * Get information about supported AI development tools
 */
export function getSupportedTools(): ToolInfo[] {
  const toolsInfo: ToolInfo[] = [
    {
      name: "cursor",
      displayName: "Cursor",
      description: "AI-powered code editor with built-in pair programming",
      features: {
        rules: true,
        mcp: true,
        ignore: false,
        commands: false,
      },
      configPaths: {
        rules: [".cursorrules"],
        mcp: [".cursor/mcp.json"],
      },
    },
    {
      name: "claudecode",
      displayName: "Claude Code",
      description: "Anthropic's official CLI for Claude AI",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: true,
      },
      configPaths: {
        rules: ["CLAUDE.md"],
        mcp: [".claude/settings.json"],
        ignore: [".claude/settings.json"],
        commands: [".claude/commands/"],
      },
    },
    {
      name: "copilot",
      displayName: "GitHub Copilot",
      description: "AI pair programmer by GitHub",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".github/copilot-instructions.md"],
        mcp: [".github/copilot-mcp.json"],
        ignore: [".github/copilot-ignore"],
      },
    },
    {
      name: "cline",
      displayName: "Cline",
      description: "VS Code extension for AI-powered coding assistance",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".cline/instructions.md"],
        mcp: [".cline/mcp.json"],
        ignore: [".clineignore"],
      },
    },
    {
      name: "roo",
      displayName: "Roo Code",
      description: "AI coding assistant for VS Code",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: true,
      },
      configPaths: {
        rules: [".roo/instructions.md"],
        mcp: [".roo/mcp.json"],
        ignore: [".rooignore"],
        commands: [".roo/commands/"],
      },
    },
    {
      name: "geminicli",
      displayName: "Gemini CLI",
      description: "Command-line interface for Google Gemini AI",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: true,
      },
      configPaths: {
        rules: ["GEMINI.md"],
        mcp: [".gemini/settings.json"],
        ignore: [".aiexclude"],
        commands: [".gemini/commands/"],
      },
    },
    {
      name: "junie",
      displayName: "JetBrains Junie",
      description: "JetBrains AI coding assistant",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".junie/guidelines.md"],
        mcp: [".junie/mcp.json"],
        ignore: [".aiignore"],
      },
    },
    {
      name: "qwencode",
      displayName: "Qwen Code",
      description: "Alibaba's Qwen AI coding assistant",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: true,
      },
      configPaths: {
        rules: ["QWEN.md"],
        mcp: [".qwen/settings.json"],
        ignore: [".gitignore"],
        commands: [".qwen/commands/"],
      },
    },
    {
      name: "agentsmd",
      displayName: "AGENTS.md",
      description: "Simple markdown-based AI instructions",
      features: {
        rules: true,
        mcp: false,
        ignore: false,
        commands: false,
      },
      configPaths: {
        rules: ["AGENTS.md"],
      },
    },
    {
      name: "augmentcode",
      displayName: "AugmentCode",
      description: "AI code completion and assistance",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".augment/rules/"],
        mcp: [".augment/mcp.json"],
        ignore: [".augmentignore"],
      },
    },
    {
      name: "windsurf",
      displayName: "Windsurf",
      description: "AI-powered code editor",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".windsurf/rules/"],
        mcp: [".windsurf/mcp.json"],
        ignore: [".codeiumignore"],
      },
    },
    {
      name: "kiro",
      displayName: "Kiro IDE",
      description: "AWS-powered AI development environment",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: [".kiro/steering/"],
        mcp: [".kiro/mcp.json"],
        ignore: [".kiro-ignore"],
      },
    },
    {
      name: "opencode",
      displayName: "OpenCode",
      description: "Open-source AI coding assistant",
      features: {
        rules: true,
        mcp: true,
        ignore: true,
        commands: false,
      },
      configPaths: {
        rules: ["AGENTS.md"],
        mcp: ["opencode.json"],
        ignore: [".gitignore"],
      },
    },
  ];

  // Filter to only include tools that are actually supported
  return toolsInfo.filter((tool) => ALL_TOOL_TARGETS.includes(tool.name));
}

// ============================================================================
// Helper Functions
// ============================================================================

async function parseRuleFile(filePath: string): Promise<ParsedRule | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, "utf-8");
    const { data: frontmatter, content: markdownContent } = matter(content);

    // Extract metadata from frontmatter
    const metadata: ParsedRule["metadata"] = {
      title: frontmatter.title || extractTitleFromContent(markdownContent),
      description: frontmatter.description,
      ...(frontmatter.targets &&
        Array.isArray(frontmatter.targets) && { targets: frontmatter.targets }),
      ...(frontmatter.globs && Array.isArray(frontmatter.globs) && { globs: frontmatter.globs }),
    };

    return {
      filePath,
      content: markdownContent,
      frontmatter,
      metadata,
    };
  } catch (error) {
    throw new IOError(
      `Failed to parse rule file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractTitleFromContent(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.substring(2).trim();
    }
  }
  return undefined;
}

async function findRuleFiles(baseDir: string): Promise<string[]> {
  const ruleFiles: string[] = [];

  // Check new format: .rulesync/rules/
  const rulesDir = join(baseDir, ".rulesync", "rules");
  if (existsSync(rulesDir)) {
    try {
      const items = await readdir(rulesDir, { withFileTypes: true, recursive: true });
      for (const item of items) {
        if (item.isFile() && item.name.endsWith(".md")) {
          // Handle nested paths correctly
          const relativePath = item.parentPath
            ? join(item.parentPath, item.name)
                .replace(rulesDir, "")
                .replace(/^[/\\]/, "")
            : item.name;
          ruleFiles.push(join(rulesDir, relativePath));
        }
      }
    } catch {
      // If recursive option is not supported, fall back to simple readdir
      try {
        const items = await readdir(rulesDir);
        for (const item of items) {
          if (item.endsWith(".md")) {
            ruleFiles.push(join(rulesDir, item));
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  // Check legacy format: .rulesync/*.md
  const legacyRulesDir = join(baseDir, ".rulesync");
  if (existsSync(legacyRulesDir) && ruleFiles.length === 0) {
    try {
      const items = await readdir(legacyRulesDir);
      for (const item of items) {
        if (item.endsWith(".md")) {
          ruleFiles.push(join(legacyRulesDir, item));
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return ruleFiles;
}
