#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { FEATURE_TYPES } from "../types/config-options.js";
import { logger } from "../utils/logger.js";
import {
  configCommand,
  generateCommand,
  gitignoreCommand,
  importCommand,
  initCommand,
} from "./commands/index.js";

const program = new Command();

// Dynamically read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");
const packageJsonPath = join(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

program
  .name("rulesync")
  .description("Unified AI rules management CLI tool")
  .version(packageJson.version, "-v, --version", "Show version");

program.command("init").description("Initialize rulesync in current directory").action(initCommand);

program
  .command("gitignore")
  .description("Add generated files to .gitignore")
  .action(gitignoreCommand);

program
  .command("import")
  .description("Import configurations from AI tools to rulesync format")
  .option(
    "-t, --targets <tool>",
    "Tool to import from (e.g., 'copilot', 'cursor', 'cline')",
    (value) => {
      return value.split(",").map((t) => t.trim());
    },
  )
  .option(
    "-f, --features <features>",
    `Comma-separated list of features to import (${FEATURE_TYPES.join(",")}) or '*' for all`,
    (value) => {
      return value.split(",").map((f) => f.trim());
    },
  )
  .option("-v, --verbose", "Verbose output")
  .action(async (options) => {
    try {
      await importCommand({
        targets: options.targets,
        features: options.features,
        verbose: options.verbose,
        configPath: options.config,
      });
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("generate")
  .description("Generate configuration files for AI tools")
  .option("--all", "[DEPRECATED] Generate for all supported AI tools (use --targets * instead)")
  .option(
    "-t, --targets <tools>",
    "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or '*' for all)",
    (value) => {
      return value.split(",").map((t) => t.trim());
    },
  )
  .option(
    "-f, --features <features>",
    `Comma-separated list of features to generate (${FEATURE_TYPES.join(",")}) or '*' for all`,
    (value) => {
      return value.split(",").map((f) => f.trim());
    },
  )
  .option("--delete", "Delete all existing files in output directories before generating")
  .option(
    "-b, --base-dir <paths>",
    "Base directories to generate files (comma-separated for multiple paths)",
  )
  .option("-v, --verbose", "Verbose output")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    try {
      await generateCommand({
        targets: options.targets,
        features: options.features,
        verbose: options.verbose,
        delete: options.delete,
        baseDirs: options.baseDirs,
        configPath: options.config,
      });
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("config")
  .description("Show or initialize rulesync configuration")
  .option("--init", "Initialize a new configuration file")
  .action(configCommand);

program.parse();
