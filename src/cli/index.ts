#!/usr/bin/env node

import { Command } from "commander";

import { ANNOUNCEMENT } from "../constants/announcements.js";
import { ALL_FEATURES } from "../types/features.js";
import { formatError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { fetchCommand } from "./commands/fetch.js";
import { generateCommand } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { mcpCommand } from "./commands/mcp.js";
import { updateCommand } from "./commands/update.js";

const getVersion = () => "7.10.0";

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
    .command("fetch <source>")
    .description("Fetch files from a Git repository (GitHub/GitLab)")
    .option(
      "-t, --target <target>",
      "Target format to interpret files as (e.g., 'rulesync', 'claudecode'). Default: rulesync",
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to fetch (${ALL_FEATURES.join(",")}) or '*' for all`,
      (value) => {
        return value.split(",").map((f) => f.trim());
      },
    )
    .option("-r, --ref <ref>", "Branch, tag, or commit SHA to fetch from")
    .option("-p, --path <path>", "Subdirectory path within the repository")
    .option("-o, --output <dir>", "Output directory (default: .rulesync)")
    .option(
      "-c, --conflict <strategy>",
      "Conflict resolution strategy: skip, overwrite (default: overwrite)",
    )
    .option("--token <token>", "Git provider token for private repositories")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(async (source, options) => {
      await fetchCommand({
        source,
        target: options.target,
        features: options.features,
        ref: options.ref,
        path: options.path,
        output: options.output,
        conflict: options.conflict,
        token: options.token,
        verbose: options.verbose,
        silent: options.silent,
      });
    });

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
    .option("-s, --silent", "Suppress all output")
    .option("-g, --global", "Import for global(user scope) configuration files")
    .action(async (options) => {
      try {
        await importCommand({
          targets: options.targets,
          features: options.features,
          verbose: options.verbose,
          silent: options.silent,
          configPath: options.config,
          global: options.global,
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
    .command("install")
    .description("Install skills from declarative sources in rulesync.jsonc")
    .option("--update", "Force re-resolve all source refs, ignoring lockfile")
    .option(
      "--frozen",
      "Fail if lockfile is missing or out of sync (for CI); fetches missing skills using locked refs",
    )
    .option("--token <token>", "GitHub token for private repos")
    .option("-c, --config <path>", "Path to configuration file")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(async (options) => {
      try {
        await installCommand({
          update: options.update,
          frozen: options.frozen,
          token: options.token,
          configPath: options.config,
          verbose: options.verbose,
          silent: options.silent,
        });
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
      (value) => {
        return value.split(",").map((p) => p.trim());
      },
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .option("-c, --config <path>", "Path to configuration file")
    .option("-g, --global", "Generate for global(user scope) configuration files")
    .option(
      "--simulate-commands",
      "Generate simulated commands. This feature is only available for copilot, cursor and codexcli.",
    )
    .option(
      "--simulate-subagents",
      "Generate simulated subagents. This feature is only available for copilot and codexcli.",
    )
    .option(
      "--simulate-skills",
      "Generate simulated skills. This feature is only available for copilot, cursor and codexcli.",
    )
    .option("--dry-run", "Dry run: show changes without writing files")
    .option("--check", "Check if files are up to date (exits with code 1 if changes needed)")
    .action(async (options) => {
      try {
        await generateCommand({
          targets: options.targets,
          features: options.features,
          verbose: options.verbose,
          silent: options.silent,
          delete: options.delete,
          baseDirs: options.baseDir,
          configPath: options.config,
          global: options.global,
          simulateCommands: options.simulateCommands,
          simulateSubagents: options.simulateSubagents,
          simulateSkills: options.simulateSkills,
          dryRun: options.dryRun,
          check: options.check,
        });
      } catch (error) {
        logger.error(formatError(error));
        process.exit(1);
      }
    });

  program
    .command("update")
    .description("Update rulesync to the latest version")
    .option("--check", "Check for updates without installing")
    .option("--force", "Force update even if already at latest version")
    .option("--token <token>", "GitHub token for API access")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(async (options) => {
      await updateCommand(version, {
        check: options.check,
        force: options.force,
        token: options.token,
        verbose: options.verbose,
        silent: options.silent,
      });
    });

  program.parse();
};

main().catch((error) => {
  logger.error(formatError(error));
  process.exit(1);
});
