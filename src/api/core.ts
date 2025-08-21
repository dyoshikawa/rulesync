import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importCommand } from "../cli/commands/import.js";
// Import CLI commands
import { validateCommand } from "../cli/commands/validate.js";
// Import core functions
import { generateCommands } from "../core/command-generator.js";
import { generateConfigurations, parseRulesFromDirectory } from "../core/index.js";
import { generateMcpConfigurations } from "../core/mcp-generator.js";
import { parseMcpConfig } from "../core/mcp-parser.js";
import type { Config as RulesyncConfig, ToolTarget } from "../types/index.js";
// Import utilities
import { loadConfig as loadConfigUtil, mergeWithCliOptions } from "../utils/config-loader.js";
import { fileExists, writeFileContent } from "../utils/index.js";
import { logger } from "../utils/logger.js";
// Import errors
import { ConfigError, GenerationError, IOError, ValidationError } from "./errors.js";
// Import types
import type {
  ConfigStatus,
  GeneratedFile,
  GeneratedFilesStatus,
  GenerateOptions,
  GenerateResult,
  ImportedFile,
  ImportOptions,
  ImportResult,
  InitializeOptions,
  InitializeResult,
  RulesStatus,
  StatusOptions,
  StatusResult,
  ValidateOptions,
  ValidateResult,
  ValidationErrorDetail,
  ValidationWarning,
} from "./types.js";

// ============================================================================
// Initialize Function
// ============================================================================

/**
 * Initialize a rulesync project
 */
export async function initialize(options: InitializeOptions = {}): Promise<InitializeResult> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();

    // Load existing config or use defaults
    const configResult = await loadConfigUtil({ cwd: baseDir });
    const config: RulesyncConfig = {
      ...configResult.config,
      ...options.config,
    };

    // Change working directory temporarily if needed
    const originalCwd = process.cwd();
    if (baseDir !== originalCwd) {
      process.chdir(baseDir);
    }

    try {
      // Create the directory structure manually since CLI init expects current working directory
      const aiRulesDir = config.aiRulesDir || ".rulesync";
      const useLegacy = options.legacy ?? config.legacy ?? false;
      const rulesDir = useLegacy ? aiRulesDir : join(aiRulesDir, "rules");

      // Ensure directories exist
      const { ensureDir } = await import("../utils/file.js");
      await ensureDir(join(baseDir, aiRulesDir));
      if (!useLegacy) {
        await ensureDir(join(baseDir, rulesDir));
      }

      // Create sample overview file
      const { writeFileContent } = await import("../utils/file.js");
      const overviewPath = join(baseDir, rulesDir, "overview.md");
      const overviewContent = `---
root: true
targets: ["cursor", "claudecode", "copilot", "cline", "roo", "geminicli", "junie", "qwencode", "agentsmd", "augmentcode", "windsurf"]
description: "Project overview and general development guidelines"
---

# Project Overview

This project uses rulesync to manage AI development tool configurations.

## Development Guidelines

- Follow TypeScript best practices
- Write comprehensive tests
- Use semantic commit messages
- Keep code clean and maintainable
`;

      await writeFileContent(overviewPath, overviewContent);

      // Create config file if it doesn't exist
      const configPath = join(baseDir, "rulesync.jsonc");
      const configCreated = !existsSync(configPath);
      if (configCreated) {
        const configContent = JSON.stringify(
          {
            aiRulesDir,
            legacy: useLegacy,
          },
          null,
          2,
        );
        await writeFileContent(configPath, configContent);
      }

      const actualCreatedFiles = [overviewPath];
      if (configCreated) {
        actualCreatedFiles.push(configPath);
      }

      return {
        createdFiles: actualCreatedFiles,
        baseDir,
        config,
      };
    } finally {
      // Restore original working directory
      if (baseDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  } catch (error) {
    throw new ConfigError(
      `Failed to initialize rulesync project: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Core Generation Function (without CLI process.exit behaviors)
// ============================================================================

/**
 * Core generation logic extracted from CLI command but without process.exit calls
 */
async function generateCore(options: GenerateOptions, baseDir: string): Promise<void> {
  // Build config loader options
  const configLoaderOptions: Record<string, unknown> = {
    ...(options.config !== undefined && { configPath: options.config }),
    ...(options.noConfig !== undefined && { noConfig: options.noConfig }),
  };

  const configResult = await loadConfigUtil(configLoaderOptions);

  // Build CLI-style options for merging
  const cliStyleOptions: {
    tools?: ToolTarget[] | undefined;
    verbose?: boolean;
    delete?: boolean;
    baseDirs?: string[];
  } = {
    tools: options.tools || (options.all ? undefined : ["cursor", "claudecode"]),
    ...(options.verbose !== undefined && { verbose: options.verbose }),
    ...(options.delete !== undefined && { delete: options.delete }),
    baseDirs: [baseDir],
  };

  const config = mergeWithCliOptions(configResult.config, cliStyleOptions);

  // Ensure tools are specified (but don't process.exit, throw error instead)
  if (!config.defaultTargets || config.defaultTargets.length === 0) {
    throw new GenerationError("At least one tool must be specified for generation");
  }

  // Set logger verbosity based on config
  const originalVerbose = logger.verbose;
  if (config.verbose !== undefined) {
    logger.setVerbose(config.verbose);
  }

  try {
    // Check if .rulesync directory exists
    const aiRulesDirPath = config.aiRulesDir.startsWith("/")
      ? config.aiRulesDir
      : join(baseDir, config.aiRulesDir);
    if (!(await fileExists(aiRulesDirPath))) {
      throw new GenerationError(".rulesync directory not found. Initialize project first.");
    }

    // Parse rules
    const rules = await parseRulesFromDirectory(aiRulesDirPath);

    if (rules.length === 0) {
      // Don't throw error, just return - this is a valid case
      return;
    }

    // Generate configurations
    const outputs = await generateConfigurations(rules, config, config.defaultTargets, baseDir);

    // Write output files
    for (const output of outputs) {
      await writeFileContent(output.filepath, output.content);
    }

    // Generate MCP configurations
    try {
      const mcpConfig = parseMcpConfig(baseDir);

      if (mcpConfig && mcpConfig.mcpServers && Object.keys(mcpConfig.mcpServers).length > 0) {
        const mcpResults = await generateMcpConfigurations(
          mcpConfig,
          baseDir === process.cwd() ? "." : baseDir,
          config.defaultTargets,
        );

        for (const result of mcpResults) {
          await writeFileContent(result.filepath, result.content);
        }
      }
    } catch {
      // Ignore MCP errors - MCP is optional
    }

    // Generate command files
    try {
      const commandResults = await generateCommands(baseDir, undefined, config.defaultTargets);

      for (const result of commandResults) {
        await writeFileContent(result.filepath, result.content);
      }
    } catch {
      // Ignore command generation errors - commands are optional
    }
  } finally {
    // Restore original logger verbosity
    logger.setVerbose(originalVerbose);
  }
}

// ============================================================================
// Generate Function
// ============================================================================

/**
 * Generate configuration files for AI tools
 */
export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  try {
    // Convert baseDirs to absolute paths
    const baseDirs = options.baseDirs?.map((dir) => resolve(dir)) || [process.cwd()];

    // Load configuration
    const configLoaderOptions: Record<string, unknown> = {};
    if (options.config) {
      configLoaderOptions.configPath = options.config;
    }
    if (options.noConfig) {
      configLoaderOptions.noConfig = options.noConfig;
    }

    const configResult = await loadConfigUtil(configLoaderOptions);

    // For each base directory, collect information about what will be generated
    const allGeneratedFiles: GeneratedFile[] = [];
    const config: RulesyncConfig = configResult.config;

    for (const baseDir of baseDirs) {
      const originalCwd = process.cwd();
      if (baseDir !== originalCwd) {
        process.chdir(baseDir);
      }

      try {
        // Track files before generation
        const beforeFiles = await getGeneratedFiles(baseDir, config);

        // Call core generation logic directly instead of CLI command
        await generateCore(options, baseDir);

        // Track files after generation
        const afterFiles = await getGeneratedFiles(baseDir, config);

        // Determine what was generated
        const generatedFiles = await determineGeneratedFiles(
          beforeFiles,
          afterFiles,
          options.tools,
          config,
        );

        allGeneratedFiles.push(...generatedFiles);
      } finally {
        if (baseDir !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    }

    // Calculate summary
    const summary = {
      totalFiles: allGeneratedFiles.length,
      successCount: allGeneratedFiles.filter((f) => f.status === "success").length,
      errorCount: allGeneratedFiles.filter((f) => f.status === "error").length,
      skippedCount: allGeneratedFiles.filter((f) => f.status === "skipped").length,
    };

    return {
      generatedFiles: allGeneratedFiles,
      config,
      summary,
    };
  } catch (error) {
    throw new GenerationError(
      `Failed to generate configuration files: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Import Function
// ============================================================================

/**
 * Import configurations from AI tools to rulesync format
 */
export async function importConfig(options: ImportOptions): Promise<ImportResult> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();

    const originalCwd = process.cwd();
    if (baseDir !== originalCwd) {
      process.chdir(baseDir);
    }

    try {
      // Track files before import
      const beforeFiles = await getRulesyncFiles(baseDir);

      // Import each source separately (CLI constraint: one tool at a time)
      for (const source of options.sources) {
        try {
          const importCliOptions: Record<string, boolean> = {
            verbose: options.verbose || false,
            legacy: options.legacy || false,
            [source]: true,
          };

          // Run CLI import command for this source
          await importCommand(importCliOptions);
        } catch {
          // Continue with other sources even if one fails
          // Error is logged by the CLI command
        }
      }

      // Track files after import
      const afterFiles = await getRulesyncFiles(baseDir);

      // Determine what was imported
      const createdFiles = afterFiles.filter((file) => !beforeFiles.includes(file));

      // Build imported files information
      const importedFiles: ImportedFile[] = [];

      for (const source of options.sources) {
        const sourceFiles = await findSourceFiles(baseDir, source);

        for (const sourceFile of sourceFiles) {
          if (existsSync(sourceFile)) {
            // Find corresponding created file
            const targetFile = createdFiles.find(
              (file) => file.includes(source) || file.includes("rules"),
            );

            importedFiles.push({
              sourcePath: sourceFile,
              tool: source,
              targetPath: targetFile || "",
              status: targetFile ? "success" : "skipped",
            });
          }
        }
      }

      const summary = {
        totalSources: options.sources.length,
        successCount: importedFiles.filter((f) => f.status === "success").length,
        errorCount: importedFiles.filter((f) => f.status === "error").length,
      };

      return {
        importedFiles,
        createdFiles,
        summary,
      };
    } finally {
      if (baseDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  } catch (error) {
    throw new ConfigError(
      `Failed to import configurations: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Validate Function
// ============================================================================

/**
 * Validate rulesync configuration
 */
export async function validate(options: ValidateOptions = {}): Promise<ValidateResult> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();

    const originalCwd = process.cwd();
    if (baseDir !== originalCwd) {
      process.chdir(baseDir);
    }

    try {
      // Run CLI validate command
      await validateCommand();

      // Since CLI validate doesn't return structured data,
      // we need to perform our own validation
      const validatedFiles: string[] = [];
      const errors: ValidationErrorDetail[] = [];
      const warnings: ValidationWarning[] = [];

      // Load and validate config
      try {
        const configLoaderOptions: Record<string, unknown> = {};
        if (options.config) {
          configLoaderOptions.configPath = options.config;
        }
        configLoaderOptions.cwd = baseDir;

        const configResult = await loadConfigUtil(configLoaderOptions);

        if (configResult.filepath) {
          validatedFiles.push(configResult.filepath);
        }
      } catch (error) {
        errors.push({
          filePath: options.config || "rulesync.jsonc",
          message: error instanceof Error ? error.message : String(error),
          type: "config",
        });
      }

      // Also check for malformed config files directly
      const configPaths = [join(baseDir, "rulesync.jsonc"), join(baseDir, "rulesync.json")];

      for (const configPath of configPaths) {
        if (existsSync(configPath)) {
          try {
            const content = await (await import("node:fs/promises")).readFile(configPath, "utf-8");
            JSON.parse(content);
            if (!validatedFiles.includes(configPath)) {
              validatedFiles.push(configPath);
            }
          } catch (error) {
            errors.push({
              filePath: configPath,
              message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              type: "syntax",
            });
          }
        }
      }

      // Validate rules files
      const rulesFiles = await getRulesFiles(baseDir);
      validatedFiles.push(...rulesFiles);

      // Basic validation passed if no errors
      const isValid = errors.length === 0;

      return {
        isValid,
        errors,
        warnings,
        validatedFiles,
      };
    } finally {
      if (baseDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  } catch (error) {
    throw new ValidationError(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Status Function
// ============================================================================

/**
 * Get current status of rulesync project
 */
export async function getStatus(options: StatusOptions = {}): Promise<StatusResult> {
  try {
    const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();

    // Check if project is initialized
    const aiRulesDir = join(baseDir, ".rulesync");
    const isInitialized = existsSync(aiRulesDir);

    // Get config status
    const configStatus = await getConfigStatus(baseDir);

    // Get rules status
    const rulesStatus = await getRulesStatus(baseDir, configStatus.config);

    // Get generated files status
    const generatedFilesStatus = await getGeneratedFilesStatusForAllTools(
      baseDir,
      configStatus.config,
    );

    return {
      isInitialized,
      configStatus,
      rulesStatus,
      generatedFilesStatus,
    };
  } catch (error) {
    throw new IOError(
      `Failed to get project status: ${error instanceof Error ? error.message : String(error)}`,
      { options },
    );
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getGeneratedFiles(baseDir: string, _config: RulesyncConfig): Promise<string[]> {
  const files: string[] = [];

  // Common generated file patterns
  const patterns = [
    ".cursor/rules/",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
    ".cline/instructions.md",
    ".roo/instructions.md",
    "GEMINI.md",
    ".junie/guidelines.md",
    "QWEN.md",
    "AGENTS.md",
    ".augment/rules/",
    ".windsurf/rules/",
  ];

  for (const pattern of patterns) {
    const filePath = join(baseDir, pattern);
    if (existsSync(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

async function determineGeneratedFiles(
  beforeFiles: string[],
  afterFiles: string[],
  tools: ToolTarget[] | undefined,
  _config: RulesyncConfig,
): Promise<GeneratedFile[]> {
  const generatedFiles: GeneratedFile[] = [];

  // Simple implementation - compare before/after files
  const newFiles = afterFiles.filter((file) => !beforeFiles.includes(file));
  const modifiedFiles = afterFiles.filter((file) => beforeFiles.includes(file));

  for (const file of [...newFiles, ...modifiedFiles]) {
    const tool = determineToolFromFile(file);
    const type = determineFileType(file);

    if (tool && (!tools || tools.includes(tool))) {
      try {
        const stats = await stat(file);
        generatedFiles.push({
          path: file,
          tool,
          type,
          status: "success",
          size: stats.size,
          lastModified: stats.mtime,
        });
      } catch (error) {
        generatedFiles.push({
          path: file,
          tool,
          type,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return generatedFiles;
}

function determineToolFromFile(filePath: string): ToolTarget | undefined {
  const fileName = filePath.toLowerCase();

  if (fileName.includes(".cursor")) return "cursor";
  if (fileName.includes("claude.md")) return "claudecode";
  if (fileName.includes("copilot-instructions")) return "copilot";
  if (fileName.includes(".cline")) return "cline";
  if (fileName.includes(".roo")) return "roo";
  if (fileName.includes("gemini.md")) return "geminicli";
  if (fileName.includes(".junie")) return "junie";
  if (fileName.includes("qwen.md")) return "qwencode";
  if (fileName.includes("agents.md")) return "agentsmd";
  if (fileName.includes(".augment")) return "augmentcode";
  if (fileName.includes(".windsurf")) return "windsurf";

  return undefined;
}

function determineFileType(filePath: string): "rules" | "mcp" | "ignore" | "commands" {
  const fileName = filePath.toLowerCase();

  if (fileName.includes("mcp") || fileName.includes("server")) return "mcp";
  if (fileName.includes("ignore") || fileName.includes(".gitignore")) return "ignore";
  if (fileName.includes("command") || fileName.includes("slash")) return "commands";

  return "rules";
}

async function getRulesyncFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];
  const rulesyncDir = join(baseDir, ".rulesync");

  if (existsSync(rulesyncDir)) {
    try {
      const items = await readdir(rulesyncDir, { withFileTypes: true, recursive: true });
      for (const item of items) {
        if (item.isFile() && item.name.endsWith(".md")) {
          files.push(join(rulesyncDir, item.name));
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return files;
}

async function findSourceFiles(baseDir: string, source: ToolTarget): Promise<string[]> {
  const sourceFiles: string[] = [];

  const patterns: Record<string, string[]> = {
    cursor: [".cursor/rules/"],
    claudecode: ["CLAUDE.md"],
    copilot: [".github/copilot-instructions.md"],
    cline: [".cline/instructions.md"],
    roo: [".roo/instructions.md"],
    geminicli: ["GEMINI.md"],
    junie: [".junie/guidelines.md"],
    qwencode: ["QWEN.md"],
    agentsmd: ["AGENTS.md"],
    augmentcode: [".augment/rules/"],
    windsurf: [".windsurf/rules/"],
    amazonqcli: ["AMAZONQ.md"],
    "augmentcode-legacy": [".augment-guidelines"],
    codexcli: ["AGENTS.md"],
    kiro: [".kiro/steering/"],
    opencode: ["AGENTS.md"],
  };

  const toolPatterns = patterns[source] || [];

  for (const pattern of toolPatterns) {
    const filePath = join(baseDir, pattern);
    sourceFiles.push(filePath);
  }

  return sourceFiles;
}

async function getRulesFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];
  const rulesDir = join(baseDir, ".rulesync", "rules");
  const legacyRulesDir = join(baseDir, ".rulesync");

  // Check new format first
  if (existsSync(rulesDir)) {
    try {
      const items = await readdir(rulesDir, { withFileTypes: true, recursive: true });
      for (const item of items) {
        if (item.isFile() && item.name.endsWith(".md")) {
          files.push(join(rulesDir, item.name));
        }
      }
    } catch {
      // Ignore read errors
    }
  } else if (existsSync(legacyRulesDir)) {
    // Check legacy format
    try {
      const items = await readdir(legacyRulesDir);
      for (const item of items) {
        if (item.endsWith(".md")) {
          files.push(join(legacyRulesDir, item));
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return files;
}

async function getConfigStatus(baseDir: string): Promise<ConfigStatus> {
  try {
    // Check if config file actually exists in this directory
    const configPaths = [
      join(baseDir, "rulesync.jsonc"),
      join(baseDir, "rulesync.json"),
      join(baseDir, "rulesync.config.js"),
      join(baseDir, "rulesync.config.ts"),
    ];

    const existingConfigPath = configPaths.find((path) => existsSync(path));

    if (!existingConfigPath) {
      return {
        exists: false,
        isValid: false,
      };
    }

    const configResult = await loadConfigUtil({ cwd: baseDir });
    return {
      exists: true,
      path: existingConfigPath,
      isValid: true,
      config: configResult.config,
    };
  } catch {
    return {
      exists: false,
      isValid: false,
    };
  }
}

async function getRulesStatus(baseDir: string, _config?: RulesyncConfig): Promise<RulesStatus> {
  const rulesFiles = await getRulesFiles(baseDir);
  const rulesDir = join(baseDir, ".rulesync", "rules");
  const usesLegacyFormat = !existsSync(rulesDir) && rulesFiles.length > 0;

  return {
    totalFiles: rulesFiles.length,
    filePaths: rulesFiles,
    usesLegacyFormat,
  };
}

async function getGeneratedFilesStatusForAllTools(
  baseDir: string,
  _config?: RulesyncConfig,
): Promise<GeneratedFilesStatus[]> {
  const tools: ToolTarget[] = [
    "cursor",
    "claudecode",
    "copilot",
    "cline",
    "roo",
    "geminicli",
    "junie",
    "qwencode",
    "agentsmd",
    "augmentcode",
    "windsurf",
  ];

  const results: GeneratedFilesStatus[] = [];

  for (const tool of tools) {
    const sourceFiles = await findSourceFiles(baseDir, tool);
    const files = [];

    for (const filePath of sourceFiles) {
      try {
        const exists = existsSync(filePath);
        let lastModified: Date | undefined;

        if (exists) {
          const stats = await stat(filePath);
          lastModified = stats.mtime;
        }

        files.push({
          path: filePath,
          type: determineFileType(filePath),
          exists,
          ...(lastModified && { lastModified }),
        });
      } catch {
        files.push({
          path: filePath,
          type: determineFileType(filePath),
          exists: false,
        });
      }
    }

    if (files.length > 0) {
      results.push({
        tool,
        files,
      });
    }
  }

  return results;
}
