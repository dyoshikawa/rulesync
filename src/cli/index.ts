#!/usr/bin/env node

import { Command } from "commander";
import { ALL_TOOL_TARGETS, type ToolTarget } from "../types/index.js";
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
  .option("--agentsmd", "Generate only for AGENTS.md")
  .option("--augmentcode", "Generate only for AugmentCode")
  .option("--augmentcode-legacy", "Generate only for AugmentCode legacy format")
  .option("--copilot", "Generate only for GitHub Copilot")
  .option("--cursor", "Generate only for Cursor")
  .option("--cline", "Generate only for Cline")
  .option("--codexcli", "Generate only for OpenAI Codex CLI")
  .option("--claudecode", "Generate only for Claude Code")
  .option("--roo", "Generate only for Roo Code")
  .option("--geminicli", "Generate only for Gemini CLI")
  .option("--junie", "Generate only for JetBrains Junie")
  .option("--qwencode", "Generate only for Qwen Code")
  .option("--kiro", "Generate only for Kiro IDE")
  .option("--opencode", "Generate only for OpenCode")
  .option("--windsurf", "Generate only for Windsurf")
  .option("--delete", "Delete all existing files in output directories before generating")
  .option(
    "-b, --base-dir <paths>",
    "Base directories to generate files (comma-separated for multiple paths)",
  )
  .option("-v, --verbose", "Verbose output")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--no-config", "Disable configuration file loading")
  .action(async (options) => {
    const tools: ToolTarget[] = [];
    if (options.all) {
      // Add all supported tools when --all is specified
      tools.push(...ALL_TOOL_TARGETS);
    } else {
      // Add individual tools based on specific options
      if (options.agentsmd) tools.push("agentsmd");
      if (options.augmentcode) tools.push("augmentcode");
      if (options["augmentcode-legacy"]) tools.push("augmentcode-legacy");
      if (options.copilot) tools.push("copilot");
      if (options.cursor) tools.push("cursor");
      if (options.cline) tools.push("cline");
      if (options.codexcli) tools.push("codexcli");
      if (options.claudecode) tools.push("claudecode");
      if (options.roo) tools.push("roo");
      if (options.geminicli) tools.push("geminicli");
      if (options.junie) tools.push("junie");
      if (options.qwencode) tools.push("qwencode");
      if (options.kiro) tools.push("kiro");
      if (options.opencode) tools.push("opencode");
      if (options.windsurf) tools.push("windsurf");
    }

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
