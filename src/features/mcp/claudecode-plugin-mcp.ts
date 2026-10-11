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
    !command.startsWith("~") &&
    !command.startsWith("../") &&
    !posix.isAbsolute(command) &&
    !win32.isAbsolute(command)
  );
}

function anchorToPluginRoot(path: string): string {
  return `${PLUGIN_ROOT_PLACEHOLDER}/${path.replace(/^\.\//, "")}`;
}

/** Turn a plugin-root path back into its `./` form, or return it unchanged. */
function relativizeFromPluginRoot(value: string): string {
  return PLUGIN_ROOT_PREFIX.test(value) ? value.replace(PLUGIN_ROOT_PREFIX, "./") : value;
}

type ServerTransform = {
  command: (command: string) => string;
  arg: (arg: string) => string;
};

/** Rewrite every stdio server's `command` and `args` with the given transform. */
function transformServers({
  mcpServers,
  transform,
}: {
  mcpServers: unknown;
  transform: ServerTransform;
}): unknown {
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return mcpServers;
  }
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, server]) => {
      if (server === null || typeof server !== "object" || Array.isArray(server)) {
        return [name, server];
      }
      const next: Record<string, unknown> = { ...server };
      if (typeof next.command === "string") {
        next.command = transform.command(next.command);
      } else if (Array.isArray(next.command)) {
        // The canonical form allows the arguments inline after the command.
        next.command = next.command.map((part: unknown, index) =>
          typeof part !== "string"
            ? part
            : index === 0
              ? transform.command(part)
              : transform.arg(part),
        );
      }
      if (Array.isArray(next.args)) {
        next.args = next.args.map((arg: unknown) =>
          typeof arg === "string" ? transform.arg(arg) : arg,
        );
      }
      return [name, next];
    }),
  );
}

/**
 * MCP servers bundled in a Claude Code plugin (`.mcp.json` at the plugin
 * root).
 *
 * Claude Code loads a plugin's `.mcp.json` with the consumer's project as the
 * working directory, so a relative `command` such as `./servers/db-server`
 * would be looked up in the consumer's repository, where the bundled binary
 * does not exist. Generate therefore rewrites a relative `command`, and every
 * `args` element that starts with `./`, to `${CLAUDE_PLUGIN_ROOT}/…`, which
 * Claude Code substitutes with the installed plugin's directory. Bare
 * executables (`npx`, `node`), absolute paths and values that already start
 * with a variable pass through. `env` values and the remote transports' `url`
 * / `headers` are left as written, because rulesync cannot tell a path from an
 * opaque string there. Import turns the plugin-root forms back into `./`.
 *
 * @see https://code.claude.com/docs/en/plugins-reference
 */
export class ClaudecodePluginMcp extends ClaudecodeMcp {
  static override async fromRulesyncMcp(
    params: ToolMcpFromRulesyncMcpParams,
  ): Promise<ClaudecodePluginMcp> {
    const base = await super.fromRulesyncMcp(params);
    const json = base.getJson();
    const mcpServers = transformServers({
      mcpServers: json.mcpServers,
      transform: {
        command: (command) =>
          isPluginRelativeCommand(command) ? anchorToPluginRoot(command) : command,
        arg: (arg) => (arg.startsWith("./") ? anchorToPluginRoot(arg) : arg),
      },
    });
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
    const mcpServers = transformServers({
      mcpServers: this.getJson().mcpServers ?? {},
      transform: { command: relativizeFromPluginRoot, arg: relativizeFromPluginRoot },
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
