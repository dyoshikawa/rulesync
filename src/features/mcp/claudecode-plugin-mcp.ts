import { posix, win32 } from "node:path";

import { ClaudecodeMcp } from "./claudecode-mcp.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import type {
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
} from "./tool-mcp.js";

/**
 * The placeholder Claude Code substitutes with the installed plugin's own
 * directory in an MCP server's `command`, `args` and `env`.
 * @see https://code.claude.com/docs/en/plugins-reference
 */
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";

// The spellings of the plugin root that import turns back into `./`: the
// braced placeholder Claude Code documents, and the shell-variable forms a
// hand-written file may use instead.
const PLUGIN_ROOT_PREFIX =
  /^(?:\$\{CLAUDE_PLUGIN_ROOT\}|"\$CLAUDE_PLUGIN_ROOT"|\$CLAUDE_PLUGIN_ROOT)\//;

/**
 * Whether a server `command` names a file inside the plugin rather than an
 * executable found on `PATH`. The command is spawned without a shell, so a
 * name with a slash is a path, and one without (`npx`, `node`, `uvx`) is a
 * `PATH` lookup. An absolute path, a home path, one that leaves the plugin
 * (`../`), and one that already starts with a variable are left as written.
 */
function isPluginRelativeCommand(command: string): boolean {
  return (
    /[\\/]/.test(command) &&
    !command.startsWith("$") &&
    !command.startsWith("%") &&
    !command.startsWith("~") &&
    !/^\.\.[\\/]/.test(command) &&
    !posix.isAbsolute(command) &&
    !win32.isAbsolute(command)
  );
}

function anchorToPluginRoot(path: string): string {
  return `${PLUGIN_ROOT_PLACEHOLDER}/${path.replace(/^\.[\\/]/, "")}`;
}

/**
 * Commands that run the script named by their first non-option argument, so
 * that argument is a file shipped with the plugin (`node ./dist/server.js`).
 * Matched against the basename, so `/usr/bin/python3` counts too.
 */
const SCRIPT_RUNNER_PATTERN =
  /^(?:node|nodejs|bun|tsx|ts-node|python(?:\d+(?:\.\d+)?)?|ruby|perl|php|sh|bash|zsh)$/;

/** Tools whose subcommand runs the script that follows it (`uv run ./server.py`). */
const RUN_SUBCOMMANDS: Record<string, string> = { uv: "run", deno: "run", bun: "run" };

/**
 * The index of the argument that names the script a runner executes, or
 * `undefined` when the command is not a script runner. Only that one argument
 * is anchored: any other `./` argument is data the server reads relative to
 * the consumer's project (`server-filesystem ./docs`), so it is left as
 * written, the same rule plugin hook commands follow.
 */
function scriptArgumentIndex({
  command,
  args,
}: {
  command: string;
  args: readonly unknown[];
}): number | undefined {
  const name = (command.split(/[\\/]/).pop() ?? command).replace(/\.exe$/i, "");
  const subcommand = Object.hasOwn(RUN_SUBCOMMANDS, name) ? RUN_SUBCOMMANDS[name] : undefined;
  if (!SCRIPT_RUNNER_PATTERN.test(name) && subcommand === undefined) return undefined;
  let index = 0;
  if (subcommand !== undefined && !SCRIPT_RUNNER_PATTERN.test(name)) {
    const found = args.findIndex((arg) => arg === subcommand);
    if (found === -1) return undefined;
    index = found + 1;
  } else if (subcommand !== undefined && args[0] === subcommand) {
    index = 1;
  }
  for (; index < args.length; index++) {
    const arg = args[index];
    if (typeof arg !== "string") return undefined;
    if (!arg.startsWith("-")) return index;
  }
  return undefined;
}

function isDotRelative(value: string): boolean {
  return /^\.[\\/]/.test(value);
}

/** Turn a plugin-root path back into its `./` form, or return it unchanged. */
function relativizeFromPluginRoot(value: string): string {
  return PLUGIN_ROOT_PREFIX.test(value) ? value.replace(PLUGIN_ROOT_PREFIX, "./") : value;
}

/** The command and arguments of a stdio server, with inline array arguments split out. */
function splitCommand(server: Record<string, unknown>): {
  command: string | undefined;
  args: unknown[];
} {
  if (Array.isArray(server.command)) {
    // The canonical form allows the arguments inline after the command.
    const [first, ...rest] = server.command as unknown[];
    return {
      command: typeof first === "string" ? first : undefined,
      args: [...rest, ...(Array.isArray(server.args) ? server.args : [])],
    };
  }
  return {
    command: typeof server.command === "string" ? server.command : undefined,
    args: Array.isArray(server.args) ? server.args : [],
  };
}

/** Anchor a server's plugin-relative command and the script its runner executes. */
function anchorServer(server: Record<string, unknown>): Record<string, unknown> {
  const { command } = splitCommand(server);
  if (command === undefined) return server;
  const next: Record<string, unknown> = { ...server };
  const anchoredCommand = isPluginRelativeCommand(command) ? anchorToPluginRoot(command) : command;
  const anchorArgs = (args: unknown[], offset: number): unknown[] => {
    const scriptIndex = scriptArgumentIndex({ command, args: splitCommand(server).args });
    return args.map((arg, index) =>
      index + offset === scriptIndex && typeof arg === "string" && isDotRelative(arg)
        ? anchorToPluginRoot(arg)
        : arg,
    );
  };
  if (Array.isArray(server.command)) {
    const inlineArgs = server.command.slice(1);
    next.command = [anchoredCommand, ...anchorArgs(inlineArgs, 0)];
    if (Array.isArray(server.args)) next.args = anchorArgs(server.args, inlineArgs.length);
  } else {
    next.command = anchoredCommand;
    if (Array.isArray(server.args)) next.args = anchorArgs(server.args, 0);
  }
  return next;
}

/** Turn every plugin-root `command` / `args` value of a server back into `./`. */
function relativizeServer(server: Record<string, unknown>): Record<string, unknown> {
  const relativize = (value: unknown): unknown =>
    typeof value === "string" ? relativizeFromPluginRoot(value) : value;
  const next: Record<string, unknown> = { ...server };
  next.command = Array.isArray(server.command)
    ? server.command.map(relativize)
    : relativize(server.command);
  if (next.command === undefined) delete next.command;
  if (Array.isArray(server.args)) next.args = server.args.map(relativize);
  return next;
}

/** Apply a per-server transform to every server entry that is an object. */
function mapServers({
  mcpServers,
  transform,
}: {
  mcpServers: unknown;
  transform: (server: Record<string, unknown>) => Record<string, unknown>;
}): unknown {
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return mcpServers;
  }
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, server]) =>
      server === null || typeof server !== "object" || Array.isArray(server)
        ? [name, server]
        : [name, transform(server as Record<string, unknown>)],
    ),
  );
}

/**
 * MCP servers bundled in a Claude Code plugin (`.mcp.json` at the plugin
 * root).
 *
 * Claude Code loads a plugin's `.mcp.json` with the consumer's project as the
 * working directory, so a relative `command` such as `./servers/db-server`
 * would be looked up in the consumer's repository, where the bundled binary
 * does not exist. Generate therefore rewrites a relative `command`, and the
 * `./` script a script runner executes (`node ./dist/server.js`,
 * `uv run ./server.py`), to `${CLAUDE_PLUGIN_ROOT}/…`, which Claude Code
 * substitutes with the installed plugin's directory. Other `./` arguments are
 * data the server reads relative to the consumer's project
 * (`server-filesystem ./docs`), so they are left as written, the same rule
 * plugin hook commands follow. Bare executables (`npx`, `node`), absolute paths
 * and values that already start with a variable pass through. `env` values and
 * the remote transports' `url` / `headers` are left as written, because
 * rulesync cannot tell a path from an opaque string there. Import turns the
 * plugin-root forms in `command` and `args` back into `./`, including the
 * shell-variable spellings a hand-written file may have copied from a hook
 * command (which Claude Code does not substitute in MCP config).
 *
 * @see https://code.claude.com/docs/en/plugins-reference
 */
export class ClaudecodePluginMcp extends ClaudecodeMcp {
  static override async fromRulesyncMcp(
    params: ToolMcpFromRulesyncMcpParams,
  ): Promise<ClaudecodePluginMcp> {
    const base = await super.fromRulesyncMcp(params);
    const json = base.getJson();
    const mcpServers = mapServers({ mcpServers: json.mcpServers, transform: anchorServer });
    return new ClaudecodePluginMcp({
      outputRoot: params.outputRoot ?? process.cwd(),
      relativeDirPath: base.getRelativeDirPath(),
      relativeFilePath: base.getRelativeFilePath(),
      fileContent: JSON.stringify({ ...json, mcpServers }, null, 2),
      validate: params.validate ?? true,
      global: params.global ?? false,
    });
  }

  static override async fromFile(params: ToolMcpFromFileParams): Promise<ClaudecodePluginMcp> {
    const base = await super.fromFile(params);
    return new ClaudecodePluginMcp({
      outputRoot: params.outputRoot ?? process.cwd(),
      relativeDirPath: base.getRelativeDirPath(),
      relativeFilePath: base.getRelativeFilePath(),
      fileContent: base.getFileContent(),
      validate: params.validate ?? true,
      global: params.global ?? false,
    });
  }

  override toRulesyncMcp(): RulesyncMcp {
    const mcpServers = mapServers({
      mcpServers: this.getJson().mcpServers ?? {},
      transform: relativizeServer,
    });
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  static override forDeletion(params: ToolMcpForDeletionParams): ClaudecodePluginMcp {
    return new ClaudecodePluginMcp({
      outputRoot: params.outputRoot ?? process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: "{}",
      validate: false,
      global: params.global ?? false,
    });
  }
}
