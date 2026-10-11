import { posix, win32 } from "node:path";

import {
  CODE_OPTIONS,
  PACKAGE_RUNNERS,
  RUN_SUBCOMMANDS,
  SCRIPT_RUNNER_PATTERN,
  SHELL_NAME_PATTERN,
  VALUE_OPTIONS,
  optionsFor,
} from "../hooks/hook-command-paths.js";
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

/** The runner name of a command word: its basename without a `.exe` suffix. */
function runnerName(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command).replace(/\.exe$/i, "");
}

type Expecting = "subcommand" | "command" | "script" | "none";

/** What follows a command word, as plugin hook commands read it. */
function afterCommandWord(name: string): Expecting {
  if (Object.hasOwn(RUN_SUBCOMMANDS, name)) return "subcommand";
  if (PACKAGE_RUNNERS.has(name)) return "command";
  return SCRIPT_RUNNER_PATTERN.test(name) ? "script" : "none";
}

/**
 * The positions in `args` that name a file the server runs, read with the
 * rules plugin hook commands follow (`hook-command-paths.ts`): the script of a
 * script runner (`node ./dist/server.js`), the command after a run subcommand
 * or package runner (`uv run ./server.py`, `npx tsx ./x.ts`), and the value of
 * an option that loads a file (`node -r ./register.js`). Only a position whose
 * value `isPath` accepts is returned. Everything else is data the server reads
 * relative to the consumer's project (`server-filesystem ./docs`), and the
 * scan stops at an option that runs inline code or standard input
 * (`node -e`, `python3 -m`, `sh -c`, `bash -s`).
 */
function fileArgumentIndices({
  command,
  args,
  isPath,
}: {
  command: string;
  args: readonly unknown[];
  isPath: (value: string) => boolean;
}): Set<number> {
  const indices = new Set<number>();
  let owner = runnerName(command);
  let expecting = afterCommandWord(owner);
  for (let index = 0; index < args.length && expecting !== "none"; index++) {
    const arg = args[index];
    if (typeof arg !== "string") break;
    if (arg.startsWith("-") && arg !== "-") {
      const isCode =
        optionsFor({ table: CODE_OPTIONS, name: owner })?.has(arg) ||
        (SHELL_NAME_PATTERN.test(owner) && arg === "-c");
      if (isCode) break;
      if (optionsFor({ table: VALUE_OPTIONS, name: owner })?.has(arg)) {
        const value = args[index + 1];
        if (typeof value === "string" && isPath(value)) indices.add(index + 1);
        index++;
      }
      continue;
    }
    if (expecting === "subcommand") {
      if (RUN_SUBCOMMANDS[owner]?.has(arg)) {
        expecting = "command";
        continue;
      }
      // `bun ./x.ts`: a runner that also takes a script directly.
      if (!SCRIPT_RUNNER_PATTERN.test(owner)) break;
      expecting = "script";
    }
    if (isPath(arg)) indices.add(index);
    if (expecting === "script") break;
    // A command word: the runner it names decides what follows.
    owner = runnerName(arg);
    expecting = afterCommandWord(owner);
  }
  return indices;
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

/**
 * Rewrite a server's command and the argument positions that name a file it
 * runs (see `fileArgumentIndices`), leaving every other argument as written.
 * Generate and import share this, so a position generate never anchors is
 * never relativized on import either, and a hand-written
 * `${CLAUDE_PLUGIN_ROOT}/…` data argument keeps its meaning.
 */
function rewriteServer({
  server,
  rewriteCommand,
  isPath,
  rewritePath,
}: {
  server: Record<string, unknown>;
  rewriteCommand: (command: string) => string;
  isPath: (value: string) => boolean;
  rewritePath: (value: string) => string;
}): Record<string, unknown> {
  const { command, args } = splitCommand(server);
  if (command === undefined) return server;
  const indices = fileArgumentIndices({ command, args, isPath });
  const rewriteArgs = (values: unknown[], offset: number): unknown[] =>
    values.map((value, index) =>
      indices.has(index + offset) && typeof value === "string" ? rewritePath(value) : value,
    );
  const next: Record<string, unknown> = { ...server };
  if (Array.isArray(server.command)) {
    const inlineArgs = server.command.slice(1);
    next.command = [rewriteCommand(command), ...rewriteArgs(inlineArgs, 0)];
    if (Array.isArray(server.args)) next.args = rewriteArgs(server.args, inlineArgs.length);
  } else {
    next.command = rewriteCommand(command);
    if (Array.isArray(server.args)) next.args = rewriteArgs(server.args, 0);
  }
  return next;
}

/** Anchor a server's plugin-relative command and the files its runner executes. */
function anchorServer(server: Record<string, unknown>): Record<string, unknown> {
  return rewriteServer({
    server,
    rewriteCommand: (command) =>
      isPluginRelativeCommand(command) ? anchorToPluginRoot(command) : command,
    isPath: isDotRelative,
    rewritePath: anchorToPluginRoot,
  });
}

/** Turn the plugin-root forms generate writes back into `./`. */
function relativizeServer(server: Record<string, unknown>): Record<string, unknown> {
  return rewriteServer({
    server,
    rewriteCommand: relativizeFromPluginRoot,
    isPath: (value) => PLUGIN_ROOT_PREFIX.test(value),
    rewritePath: relativizeFromPluginRoot,
  });
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
