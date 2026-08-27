import { Command } from "commander";

import { DEFAULT_LATEST_COUNT } from "../lib/release-notes.js";
import { ALL_FEATURES, RulesyncFeatures } from "../types/features.js";
import { FetchOptions } from "../types/fetch.js";
import type { Logger } from "../utils/logger.js";
import { parseCommaSeparatedList } from "../utils/parse-comma-separated-list.js";
import { addCommand, type AddCommandOptions } from "./commands/add.js";
import { convertCommand, ConvertOptions } from "./commands/convert.js";
import { docsCommand, type DocsOptions } from "./commands/docs.js";
import { doctorCommand, type DoctorOptions } from "./commands/doctor.js";
import { fetchCommand } from "./commands/fetch.js";
import { generateCommand, GenerateOptions } from "./commands/generate.js";
import { gitignoreCommand } from "./commands/gitignore.js";
import { importCommand, ImportOptions } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { INSTALL_MODES, InstallMode, installCommand } from "./commands/install.js";
import { mcpCommand } from "./commands/mcp.js";
import { releaseNotesCommand, type ReleaseNotesCommandOptions } from "./commands/release-notes.js";
import { resolveGitignoreTargets } from "./commands/resolve-gitignore-targets.js";
import { updateCommand, UpdateCommandOptions } from "./commands/update.js";
import { wrapCommand as _wrapCommand } from "./wrap-command.js";

const getVersion = () => "16.17.0";
const FEATURES_HELP = `${ALL_FEATURES.join(",")}; ignore is deprecated, use permissions`;

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

export function createProgram(): Command {
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
      `Comma-separated list of features to include (${FEATURES_HELP}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("gitignore", "GITIGNORE_FAILED", async (logger, options) => {
        const cliTargets = (options as { targets?: string[] }).targets;
        const cliFeatures = (options as { features?: RulesyncFeatures }).features;

        const resolvedTargets = await resolveGitignoreTargets({ cliTargets });

        await gitignoreCommand(logger, {
          targets: resolvedTargets ? [...resolvedTargets] : undefined,
          features: cliFeatures,
          verbose: (options as { verbose?: boolean }).verbose,
          silent: (options as { silent?: boolean }).silent,
        });
      }),
    );

  program
    .command("add <source>")
    .description(
      "Add a Rulesync feature file (ignore is deprecated; use permissions) or install a declarative rule or skill source",
    )
    .option("--name <name>", "Name for a rule, command, subagent, skill, or check scaffold")
    .option("-f, --force", "Overwrite an existing scaffold file without prompting")
    .option("--skills <skills>", "Comma-separated skill names to install", parseCommaSeparatedList)
    .option("--rules <rules>", "Comma-separated rule names to install", parseCommaSeparatedList)
    .option("--transport <transport>", "Source transport: github, git, or npm")
    .option("-r, --ref <ref>", "Git ref, npm version, or npm dist-tag")
    .option("-p, --path <path>", "Skills path within the source")
    .option("--rules-path <path>", "Rules path within the source")
    .option("--registry <url>", "npm-compatible registry URL")
    .option("--token-env <name>", "Environment variable containing the npm registry token")
    .option("--token <token>", "GitHub token for private repositories")
    .option("-c, --config <path>", "Path to configuration file")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("add", "ADD_FAILED", async (logger, options, _globalOpts, positionalArgs) => {
        const source = positionalArgs[0] as string;
        const addOptions = options as Omit<AddCommandOptions, "source" | "configPath"> & {
          config?: string;
        };
        await addCommand(logger, {
          ...addOptions,
          source,
          configPath: addOptions.config,
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
      `Comma-separated list of features to fetch (${FEATURES_HELP}) or '*' for all. Default: skills`,
      parseCommaSeparatedList,
    )
    .option("-r, --ref <ref>", "Branch, tag, or commit SHA to fetch from")
    .option("-p, --path <path>", "Subdirectory path within the repository")
    .option("-o, --output <dir>", "Output directory (default: .rulesync)")
    .option(
      "-c, --conflict <strategy>",
      "Conflict resolution strategy: skip, overwrite (default: overwrite)",
    )
    .option(
      "--no-prune",
      "Keep local files inside a fetched skill directory that the remote skill no longer has (they are deleted by default)",
    )
    .option(
      "--skills <skills>",
      "Comma-separated list of skill names to fetch (requires the skills feature)",
      parseCommaSeparatedList,
    )
    .option(
      "-i, --interactive",
      "Interactively select which skills to fetch via a checkbox prompt; nothing is selected initially, press <a> to select/deselect all (requires the skills feature)",
    )
    .option("--token <token>", "Git provider token for private repositories")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("fetch", "FETCH_FAILED", async (logger, options, globalOpts, positionalArgs) => {
        const fetchOptions = options as FetchOptions;
        // The interactive prompt draws its UI on stdout; mixing it with the
        // global --json envelope would corrupt the machine-readable output.
        if (fetchOptions.interactive && globalOpts.json) {
          throw new Error("The --interactive option cannot be combined with --json output.");
        }
        const source = positionalArgs[0] as string;
        await fetchCommand(logger, { ...fetchOptions, source });
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
      `Comma-separated list of features to import (${FEATURES_HELP}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .option("-g, --global", "Import for global(user scope) configuration files")
    .option(
      "-o, --output-root <path>",
      "Root directory containing the tool configuration to import",
    )
    .action(
      wrapCommand("import", "IMPORT_FAILED", async (logger, options) => {
        const { outputRoot, ...importOptions } = options as ImportOptions & {
          outputRoot?: string;
        };
        await importCommand(logger, {
          ...importOptions,
          outputRoots: outputRoot ? [outputRoot] : undefined,
        });
      }),
    );

  program
    .command("convert")
    .description(
      "Convert configurations from one AI tool to other AI tools without writing .rulesync/ files",
    )
    .requiredOption("--from <tool>", "Source tool to convert from (e.g., 'cursor', 'claudecode')")
    .requiredOption(
      "--to <tools>",
      "Comma-separated list of destination tools (e.g., 'copilot,claudecode')",
      parseCommaSeparatedList,
    )
    .option(
      "-f, --features <features>",
      `Comma-separated list of features to convert (${FEATURES_HELP}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .option("-g, --global", "Convert for global(user scope) configuration files")
    .option("--dry-run", "Dry run: show changes without writing files")
    .action(
      wrapCommand("convert", "CONVERT_FAILED", async (logger, options) => {
        await convertCommand(logger, options as ConvertOptions);
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
    .description(
      "Install rules, skills, or primitives from declarative sources (rulesync.jsonc) or apm.yml",
    )
    .option(
      "--mode <mode>",
      `Install layout to produce (${INSTALL_MODES.join("|")}). Default: rulesync`,
    )
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
        const rawMode = (options as { mode?: string }).mode;
        const mode = parseInstallMode(rawMode);
        await installCommand(logger, {
          mode,
          update: (options as { update?: boolean }).update,
          frozen: (options as { frozen?: boolean }).frozen,
          token: (options as { token?: string }).token,
          configPath: (options as { config?: string }).config,
          verbose: (options as { verbose?: boolean }).verbose,
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
      `Comma-separated list of features to generate (${FEATURES_HELP}) or '*' for all`,
      parseCommaSeparatedList,
    )
    .option("--delete", "Delete all existing files in output directories before generating")
    .option(
      "-o, --output-roots <paths>",
      "Output root directories to generate files into (comma-separated for multiple paths)",
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
    .option(
      "--input-roots <paths...>",
      "Ordered list of rulesync source-tree directories (e.g. .rulesync, .rulesync.local). Each entry is a source tree itself — the directory that directly contains rules/, skills/, mcp.jsonc, etc. The first root is required; later roots are optional overlays and may be absent. Later entries override earlier ones when the same relative source path is present in more than one root. Cannot be combined with --input-root.",
    )
    .option(
      "--input-root <path>",
      "[DEPRECATED] Path to the PARENT directory of a `.rulesync/` source tree. Expands to `--input-roots <path>/.rulesync` for backward compatibility. Prefer `--input-roots` and point it directly at your source tree(s). Cannot be combined with --input-roots.",
    )
    .option("--dry-run", "Dry run: show changes without writing files")
    .option("--check", "Check if files are up to date (exits with code 1 if changes needed)")
    .option(
      "-w, --watch",
      "Keep running and regenerate whenever rulesync source files change (cannot be combined with --check, --dry-run or --json)",
    )
    .action(
      wrapCommand("generate", "GENERATION_FAILED", async (logger, options) => {
        await generateCommand(logger, options as GenerateOptions);
      }),
    );

  program
    .command("doctor")
    .description(
      "Diagnose the rulesync configuration for common problems (read-only, never writes files)",
    )
    .option("-c, --config <path>", "Path to configuration file")
    .option("--strict", "Treat warnings as errors (exit with code 1)")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("doctor", "DOCTOR_FAILED", async (logger, options) => {
        await doctorCommand(logger, options as DoctorOptions);
      }),
    );

  program
    .command("docs [document]")
    .description(
      "Print bundled documentation: a document by identifier (e.g. guide/configuration), the list of documents, or --search results",
    )
    .option("--search <text>", "Search the bundled documentation and print ranked matches")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand("docs", "DOCS_FAILED", async (logger, options, globalOpts, positionalArgs) => {
        // The command's product is raw Markdown on stdout; mixing it with the
        // global --json envelope would break both consumers.
        if (globalOpts.json) {
          throw new Error("The docs command prints raw Markdown and does not support --json.");
        }
        const document = positionalArgs[0] as string | undefined;
        await docsCommand(logger, document, options as DocsOptions);
      }),
    );

  program
    .command("release-notes <source>")
    .description("Print GitHub release notes for a repository (e.g., 'owner/repo')")
    .option(
      "--latest <count>",
      `Print the most recent <count> releases (default: ${DEFAULT_LATEST_COUNT})`,
    )
    .option("--since <date>", "Only releases published on or after this date (e.g., 2026-01-01)")
    .option("--until <date>", "Only releases published on or before this date (e.g., 2026-06-30)")
    .option("--tag <tag>", "Print a single release by tag name (e.g., v16.11.0)")
    .option("--from <tag>", "Start tag of a version range (requires --to)")
    .option("--to <tag>", "End tag of a version range (requires --from)")
    .option("--include-prereleases", "Include prereleases (excluded by default)")
    .option("--token <token>", "GitHub token for private repositories or higher rate limits")
    .option("-V, --verbose", "Verbose output")
    .option("-s, --silent", "Suppress all output")
    .action(
      wrapCommand(
        "release-notes",
        "RELEASE_NOTES_FAILED",
        async (logger, options, _globalOpts, positionalArgs) => {
          const source = positionalArgs[0] as string;
          await releaseNotesCommand(logger, {
            ...(options as Omit<ReleaseNotesCommandOptions, "source">),
            source,
          });
        },
      ),
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
        await updateCommand(logger, version, options as UpdateCommandOptions);
      }),
    );

  return program;
}

function parseInstallMode(raw: string | undefined): InstallMode | undefined {
  if (raw === undefined) return undefined;
  const match = INSTALL_MODES.find((m) => m === raw);
  if (!match) {
    throw new Error(`Invalid --mode value "${raw}". Expected one of: ${INSTALL_MODES.join(", ")}.`);
  }
  return match;
}
