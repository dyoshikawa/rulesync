#!/usr/bin/env node

import { Command } from "commander";
import type { ToolTarget } from "../types/index.js";
import { logger } from "../utils/logger.js";
import {
  addCommand,
  configCommand,
  generateCommand,
  gitignoreCommand,
  importCommand,
  initCommand,
  statusCommand,
  validateCommand,
  watchCommand,
} from "./commands/index.js";
import {
  checkDeprecatedFlags,
  getDeprecationWarning,
  mergeAndDeduplicateTools,
  parseTargets,
  validateToolsNotEmpty,
} from "./utils/targets-parser.js";

const program = new Command();

program.name("rulesync").description("Unified AI rules management CLI tool").version("0.65.0");

program
  .command("init")
  .description("Initialize rulesync in current directory")
  .option("--legacy", "Use legacy file location (.rulesync/*.md instead of .rulesync/rules/*.md)")
  .action(initCommand);

program
  .command("add <filename>")
  .description("Add a new rule file")
  .option("--legacy", "Use legacy file location (.rulesync/*.md instead of .rulesync/rules/*.md)")
  .action(addCommand);

program
  .command("gitignore")
  .description("Add generated files to .gitignore")
  .action(gitignoreCommand);

program
  .command("import")
  .description("Import configurations from AI tools to rulesync format")
  .option("--agentsmd", "Import from AGENTS.md (AGENTS.md)")
  .option("--augmentcode", "Import from AugmentCode (.augment/rules/)")
  .option("--augmentcode-legacy", "Import from AugmentCode legacy format (.augment-guidelines)")
  .option("--claudecode", "Import from Claude Code (CLAUDE.md)")
  .option("--cursor", "Import from Cursor (.cursorrules)")
  .option("--copilot", "Import from GitHub Copilot (.github/copilot-instructions.md)")
  .option("--cline", "Import from Cline (.cline/instructions.md)")
  .option("--roo", "Import from Roo Code (.roo/instructions.md)")
  .option("--geminicli", "Import from Gemini CLI (GEMINI.md)")
  .option("--junie", "Import from JetBrains Junie (.junie/guidelines.md)")
  .option("--qwencode", "Import from Qwen Code (QWEN.md)")
  .option("--opencode", "Import from OpenCode (AGENTS.md)")
  .option("-v, --verbose", "Verbose output")
  .option("--legacy", "Use legacy file location (.rulesync/*.md instead of .rulesync/rules/*.md)")
  .action(importCommand);

program
  .command("generate")
  .description("Generate configuration files for AI tools")
  .option("--all", "Generate for all supported AI tools")
  .option(
    "-t, --targets <tools>",
    "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or 'all')",
  )
  .option("--agentsmd", "[DEPRECATED] Generate only for AGENTS.md (use --targets agentsmd)")
  .option(
    "--amazonqcli",
    "[DEPRECATED] Generate only for Amazon Q Developer CLI (use --targets amazonqcli)",
  )
  .option("--augmentcode", "[DEPRECATED] Generate only for AugmentCode (use --targets augmentcode)")
  .option(
    "--augmentcode-legacy",
    "[DEPRECATED] Generate only for AugmentCode legacy format (use --targets augmentcode-legacy)",
  )
  .option("--copilot", "[DEPRECATED] Generate only for GitHub Copilot (use --targets copilot)")
  .option("--cursor", "[DEPRECATED] Generate only for Cursor (use --targets cursor)")
  .option("--cline", "[DEPRECATED] Generate only for Cline (use --targets cline)")
  .option("--codexcli", "[DEPRECATED] Generate only for OpenAI Codex CLI (use --targets codexcli)")
  .option("--claudecode", "[DEPRECATED] Generate only for Claude Code (use --targets claudecode)")
  .option("--roo", "[DEPRECATED] Generate only for Roo Code (use --targets roo)")
  .option("--geminicli", "[DEPRECATED] Generate only for Gemini CLI (use --targets geminicli)")
  .option("--junie", "[DEPRECATED] Generate only for JetBrains Junie (use --targets junie)")
  .option("--qwencode", "[DEPRECATED] Generate only for Qwen Code (use --targets qwencode)")
  .option("--kiro", "[DEPRECATED] Generate only for Kiro IDE (use --targets kiro)")
  .option("--opencode", "[DEPRECATED] Generate only for OpenCode (use --targets opencode)")
  .option("--windsurf", "[DEPRECATED] Generate only for Windsurf (use --targets windsurf)")
  .option("--delete", "Delete all existing files in output directories before generating")
  .option(
    "-b, --base-dir <paths>",
    "Base directories to generate files (comma-separated for multiple paths)",
  )
  .option("-v, --verbose", "Verbose output")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--no-config", "Disable configuration file loading")
  .action(async (options) => {
    try {
      let tools: ToolTarget[] = [];

      // Parse tools from --targets flag
      const targetsTools: ToolTarget[] = options.targets ? parseTargets(options.targets) : [];

      // Check for deprecated individual flags
      const deprecatedTools: ToolTarget[] = checkDeprecatedFlags(options);

      // Show deprecation warning if deprecated flags are used
      if (deprecatedTools.length > 0) {
        logger.warn(getDeprecationWarning(deprecatedTools));
      }

      // Merge and deduplicate tools from all sources
      tools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, options.all === true);

      // Validate that at least one tool is specified
      validateToolsNotEmpty(tools);

      const generateOptions: {
        verbose?: boolean;
        tools?: ToolTarget[] | undefined;
        delete?: boolean;
        baseDirs?: string[];
        config?: string;
        noConfig?: boolean;
      } = {
        verbose: options.verbose,
        tools: tools.length > 0 ? tools : undefined,
        delete: options.delete,
        config: options.config,
        noConfig: options.noConfig,
      };

      if (options.baseDir) {
        generateOptions.baseDirs = options.baseDir
          .split(",")
          .map((dir: string) => dir.trim())
          .filter((dir: string) => dir.length > 0);
      }

      await generateCommand(generateOptions);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.command("validate").description("Validate rulesync configuration").action(validateCommand);

program.command("status").description("Show current status of rulesync").action(statusCommand);

program
  .command("watch")
  .description("Watch for changes and auto-generate configurations")
  .action(watchCommand);

program
  .command("config")
  .description("Show or initialize rulesync configuration")
  .option("--init", "Initialize a new configuration file")
  .option("--format <format>", "Configuration file format (jsonc, ts)", "jsonc")
  .option("--targets <tools>", "Comma-separated list of tools to generate for")
  .option("--exclude <tools>", "Comma-separated list of tools to exclude")
  .option("--ai-rules-dir <dir>", "Directory containing AI rule files")
  .option("--base-dir <path>", "Base directory for generation")
  .option("--verbose", "Enable verbose output")
  .option("--delete", "Delete existing files before generating")
  .action(configCommand);

program.parse();
