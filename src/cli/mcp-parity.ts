/**
 * The CLI surface the MCP server (`rulesync mcp`) deliberately does not expose.
 *
 * Every other CLI command and option has an MCP counterpart on `rulesyncTool`:
 * a command `foo-bar` is the `fooBar` feature with a `run` operation, and its
 * options (and positional arguments) are keys of `fooBarOptions`.
 * `src/cli/mcp-parity.test.ts` enforces this, so a new command or option has
 * to land with MCP support or with an entry here explaining why not.
 */
export const MCP_PARITY_EXCLUSIONS = {
  /** CLI commands with no MCP feature at all. */
  commands: {
    mcp: "Starts the MCP server itself.",
    update:
      "Replaces the rulesync binary the server is running from; npm and Homebrew installs only print upgrade instructions.",
  },
  /** Program-level options (`rulesync --json <command>`). */
  globalOptions: {
    version: "Prints the CLI version; not a command an agent runs.",
    json: "MCP results are always structured JSON.",
  },
  /** Options excluded from every command that has them. */
  options: {
    verbose: "The MCP server writes no console output.",
    silent: "The MCP server writes no console output.",
    token:
      "Secrets stay out of tool arguments; GITHUB_TOKEN / GH_TOKEN from the server's environment is used instead.",
  },
  /** Options excluded from one command only, keyed by CLI command name. */
  commandOptions: {
    generate: {
      watch: "Long-running; an MCP call must return.",
    },
    fetch: {
      interactive: "Needs a terminal prompt; select skills with `skills` instead.",
    },
  },
} as const satisfies {
  commands: Record<string, string>;
  globalOptions: Record<string, string>;
  options: Record<string, string>;
  commandOptions: Record<string, Record<string, string>>;
};

/**
 * CLI option names (commander attribute names) whose MCP option key differs.
 * Anything not listed maps to the same name: `--dry-run` is `dryRun`,
 * `--no-prune` is `prune`, `--output-root` is `outputRoot`.
 */
export const MCP_OPTION_NAME_MAP: Readonly<Record<string, string>> = {
  config: "configPath",
};

/** The `rulesyncTool` feature for a CLI command name (`release-notes` → `releaseNotes`). */
export function mcpFeatureForCommand(commandName: string): string {
  return commandName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
