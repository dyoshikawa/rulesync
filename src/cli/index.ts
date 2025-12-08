#!/usr/bin/env node

import { Command } from "commander";
import { ANNOUNCEMENT } from "../constants/announcements.js";
import { ALL_FEATURES } from "../types/features.js";
import { formatError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { generateCommand } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { mcpCommand } from "./commands/mcp.js";

const getVersion = () => "3.30.0";

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
    .option("-g, --global", "Import for global(user scope) configuration files")
    .option(
      "--experimental-global",
      "Import for global(user scope) configuration files (deprecated: use --global instead)",
    )
    .action(async (options) => {
      try {
        await importCommand({
          targets: options.targets,
          features: options.features,
          verbose: options.verbose,
          configPath: options.config,
          global: options.global,
          experimentalGlobal: options.experimentalGlobal,
        });
      } catch (error) {
        logger.error(formatError(error));
        process.exit(1);
      }
    });

  program
    .command("mcp")
    .description("Start MCP server for rulesync")
    .action(async () => {
      try {
        await mcpCommand({ version });
      } catch (error) {
        logger.error(formatError(error));
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
    .option("-g, --global", "Generate for global(user scope) configuration files")
    .option(
      "--simulate-commands",
      "Generate simulated commands. This feature is only available for copilot, cursor and codexcli.",
    )
    .option(
      "--simulate-subagents",
      "Generate simulated subagents. This feature is only available for copilot, cursor and codexcli.",
    )
    .option(
      "--simulate-skills",
      "Generate simulated skills. This feature is only available for copilot, cursor and codexcli.",
    )
    .option(
      "--experimental-global",
      "Generate for global(user scope) configuration files (deprecated: use --global instead)",
    )
    .option(
      "--experimental-simulate-commands",
      "Generate simulated commands (deprecated: use --simulate-commands instead)",
    )
    .option(
      "--experimental-simulate-subagents",
      "Generate simulated subagents (deprecated: use --simulate-subagents instead)",
    )
    .option(
      "--modular-mcp",
      "Generate modular-mcp configuration for context compression (experimental)",
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
          global: options.global,
          simulateCommands: options.simulateCommands,
          simulateSubagents: options.simulateSubagents,
          simulateSkills: options.simulateSkills,
          modularMcp: options.modularMcp,
          experimentalGlobal: options.experimentalGlobal,
          experimentalSimulateCommands: options.experimentalSimulateCommands,
          experimentalSimulateSubagents: options.experimentalSimulateSubagents,
        });
      } catch (error) {
        logger.error(formatError(error));
        process.exit(1);
      }
    });

  program.parse();
};

main().catch((error) => {
  logger.error(formatError(error));
  process.exit(1);
});
