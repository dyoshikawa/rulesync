/**
 * Hermes Agent configuration-layout conventions.
 *
 * Single source of truth for where Hermes Agent expects its files.
 *
 * - Rules: Hermes Agent auto-injects a project-root `.hermes.md` file into its
 *   system prompt. There is no documented user-level rules file analogous to the
 *   global instructions of other tools (the global `~/.hermes/SOUL.md` is an
 *   agent-identity slot, not user instructions), so rules are project-scope only.
 * - MCP: Hermes Agent reads MCP servers from the `mcp_servers` key of the shared
 *   global config `~/.hermes/config.yaml` (the HERMES_HOME directory). That file
 *   also holds unrelated settings (model, terminal, ...), so generation merges
 *   the `mcp_servers` block into the existing config instead of overwriting it.
 */

/** Project-root instruction file auto-injected by Hermes Agent. */
export const HERMESAGENT_RULE_FILE_NAME = ".hermes.md";

/** Root directory for Hermes Agent global configuration (the HERMES_HOME dir). */
export const HERMESAGENT_GLOBAL_DIR = ".hermes";

/** MCP servers and other settings live in `config.yaml` under `~/.hermes/`. */
export const HERMESAGENT_MCP_FILE_NAME = "config.yaml";
