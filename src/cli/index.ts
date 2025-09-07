#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ANNOUNCEMENT } from "../constants/announcements.js";
import { FEATURE_TYPES } from "../types/config-options.js";
import { readJsonFile } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { configCommand } from "./commands/config.js";
import { generateCommand } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";

const getVersion = async (): Promise<string> => {
  try {
    // Try to read version from package.json dynamically
    // Use different approaches for ESM and CJS
    let packageJsonPath: string;

    if (typeof import.meta !== "undefined" && import.meta.url) {
      // ESM environment
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = join(__filename, "..");
      packageJsonPath = join(__dirname, "../../package.json");
    } else {
      // CJS environment fallback - use process.cwd() as fallback
      packageJsonPath = join(process.cwd(), "package.json");
    }

    const packageJson = await readJsonFile<{ version: string }>(packageJsonPath);
    return packageJson.version;
  } catch {
    // Fallback to a hardcoded version if reading fails
    return "0.70.0";
  }
};

const main = async () => {
  const program = new Command();

  const version = await getVersion();

  program.hook("postAction", () => {
    if (ANNOUNCEMENT.length > 0) {
      logger.info(ANNOUNCEMENT);
    }
  });

  program
    .name("rulesync")
    .description("Unified AI rules management CLI tool")
    .version(version, "-v, --version", "Show version");

  program
    .command("init")
    .description("Initialize rulesync in current directory")
    .action(initCommand);

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
    .option("-V, --verbose", "Verbose output")
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
    .option("-V, --verbose", "Verbose output")
    .option("-c, --config <path>", "Path to configuration file")
    .option(
      "--experimental-simulate-commands",
      "Generate simulated commands (experimental feature). This feature is only available for copilot, cursor and codexcli.",
    )
    .option(
      "--experimental-simulate-subagents",
      "Generate simulated subagents (experimental feature). This feature is only available for copilot, cursor and codexcli.",
    )
    .action(async (options) => {
      try {
        await generateCommand({
          targets: options.targets,
          features: options.features,
          verbose: options.verbose,
          delete: options.delete,
          baseDirs: options.baseDirs,
          configPath: options.config,
          experimentalSimulateCommands: options.experimentalSimulateCommands,
          experimentalSimutateSubagents: options.experimentalSimutateSubagents,
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
};

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
