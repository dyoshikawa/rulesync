#!/usr/bin/env node

import { Command } from "commander";

import { ALL_FEATURES, RulesyncFeatures } from "../types/features.js";
import { FetchOptions } from "../types/fetch.js";
import { formatError } from "../utils/error.js";
import type { Logger } from "../utils/logger.js";
import { parseCommaSeparatedList } from "../utils/parse-comma-separated-list.js";
import { fetchCommand } from "./commands/fetch.js";
import { generateCommand, GenerateOptions } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand, ImportOptions } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { mcpCommand } from "./commands/mcp.js";
import { updateCommand, UpdateCommandOptions } from "./commands/update.js";
import { wrapCommand as _wrapCommand } from "./wrap-command.js";

const getVersion = () => "7.21.0";

function wrapCommand(
  name: string,
  errorCode: string,
  handler: (
    logger: Logger,
    options: unknown,
    globalOpts: Record<string, unknown>,
    positionalArgs: unknown[],
  ) => Promise<void>,
) {
  return _wrapCommand({ name, errorCode, handler, getVersion });
}

const main = async () => {
  const program = new Command();

  const version = getVersion();

  program
    .name("rulesync")
    .description("Unified AI rules management CLI tool")
    .version(version, "-v, --version", "Show version")
    .option("-j, --json", "Output results as JSON");

  program
    .command("init")
    .description("Initialize rulesync in current directory")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("init", "INIT_FAILED", async (logger) => {
        await initCommand(logger);
      }),
    );

  program
    .command("gitignore")
    .description("Add generated files to .gitignore")
    .option(
      "-t, --targets <tools>",
      "Comma-separated list of tools to include (e.g., 'claudecode,copilot' or '*' for all)",
      parseCommaSeparatedList,
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to include (${ALL_FEATURES.join(",")}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("gitignore", "GITIGNORE_FAILED", async (logger, options) => {
        await gitignoreCommand(logger, {
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          targets: (options as { targets?: string[] }).targets,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          features: (options as { features?: RulesyncFeatures }).features,
        });
      }),
    );

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
      parseCommaSeparatedList,
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
    .action(
      wrapCommand("fetch", "FETCH_FAILED", async (logger, options, _globalOpts, positionalArgs) => {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        const source = positionalArgs[0] as string;
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        await fetchCommand(logger, { ...(options as FetchOptions), source });
      }),
    );

  program
    .command("import")
    .description("Import configurations from AI tools to rulesync format")
    .option(
      "-t, --targets <tool>",
      "Tool to import from (e.g., 'copilot', 'cursor', 'cline')",
      parseCommaSeparatedList,
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to import (${ALL_FEATURES.join(",")}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .option("-g, --global", "Import for global(user scope) configuration files")
    .action(
      wrapCommand("import", "IMPORT_FAILED", async (logger, options) => {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        await importCommand(logger, options as ImportOptions);
      }),
    );

  program
    .command("mcp")
    .description("Start MCP server for rulesync")
    .action(
      wrapCommand("mcp", "MCP_FAILED", async (logger, _options) => {
        await mcpCommand(logger, { version });
      }),
    );

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
    .action(
      wrapCommand("install", "INSTALL_FAILED", async (logger, options) => {
        await installCommand(logger, {
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          update: (options as { update?: boolean }).update,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          frozen: (options as { frozen?: boolean }).frozen,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          token: (options as { token?: string }).token,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          configPath: (options as { config?: string }).config,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          verbose: (options as { verbose?: boolean }).verbose,
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          silent: (options as { silent?: boolean }).silent,
        });
      }),
    );

  program
    .command("generate")
    .description("Generate configuration files for AI tools")
    .option(
      "-t, --targets <tools>",
      "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or '*' for all)",
      parseCommaSeparatedList,
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to generate (${ALL_FEATURES.join(",")}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("--delete", "Delete all existing files in output directories before generating")
    .option(
      "-b, --base-dir <paths>",
      "Base directories to generate files (comma-separated for multiple paths)",
      parseCommaSeparatedList,
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
    .action(
      wrapCommand("generate", "GENERATION_FAILED", async (logger, options) => {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        await generateCommand(logger, options as GenerateOptions);
      }),
    );

  program
    .command("update")
    .description("Update rulesync to the latest version")
    .option("--check", "Check for updates without installing")
    .option("--force", "Force update even if already at latest version")
    .option("--token <token>", "GitHub token for API access")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("update", "UPDATE_FAILED", async (logger, options) => {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        await updateCommand(logger, version, options as UpdateCommandOptions);
      }),
    );

  program.parse();
};

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
