#!/usr/bin/env node

import { Command } from "commander";
import { ANNOUNCEMENT } from "../constants/announcements.js";
import { ALL_FEATURES } from "../types/features.js";
import { logger } from "../utils/logger.js";
import { generateCommand } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";

const getVersion = () => "3.5.1";

const main = async () => {
  const program = new Command();

  const version = getVersion();

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
      `Comma-separated list of features to import (${ALL_FEATURES.join(",")}) or '*' for all`,
      (value) => {
        return value.split(",").map((f) => f.trim());
      },
    )
    .option("-V, --verbose", "Verbose output")
    .option("-g, --experimental-global", "Import for global(user scope) configuration files")
    .action(async (options) => {
      try {
        await importCommand({
          targets: options.targets,
          features: options.features,
          verbose: options.verbose,
          configPath: options.config,
          experimentalGlobal: options.experimentalGlobal,
        });
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program
    .command("generate")
    .description("Generate configuration files for AI tools")
    .option(
      "-t, --targets <tools>",
      "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or '*' for all)",
      (value) => {
        return value.split(",").map((t) => t.trim());
      },
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to generate (${ALL_FEATURES.join(",")}) or '*' for all`,
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
    .option("-g, --experimental-global", "Generate for global(user scope) configuration files")
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
          experimentalGlobal: options.experimentalGlobal,
          experimentalSimulateCommands: options.experimentalSimulateCommands,
          experimentalSimulateSubagents: options.experimentalSimulateSubagents,
        });
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program.parse();
};

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
