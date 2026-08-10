import { join } from "node:path";

export const TAKT_DIR = ".takt";
export const TAKT_FACETS_SUBDIR = "facets";
const TAKT_FACETS_DIR_PATH = join(TAKT_DIR, TAKT_FACETS_SUBDIR);
export const TAKT_RULES_DIR_PATH = join(TAKT_FACETS_DIR_PATH, "policies");
export const TAKT_COMMANDS_DIR_PATH = join(TAKT_FACETS_DIR_PATH, "instructions");
export const TAKT_SKILLS_DIR_PATH = join(TAKT_FACETS_DIR_PATH, "knowledge");
export const TAKT_SUBAGENTS_DIR_PATH = join(TAKT_FACETS_DIR_PATH, "personas");
export const TAKT_OUTPUT_CONTRACTS_DIR_PATH = join(TAKT_FACETS_DIR_PATH, "output-contracts");
export const TAKT_RULE_OVERVIEW_FILE_NAME = "overview.md";

/**
 * Takt's shared config file. Lives at `.takt/config.yaml` (project) and
 * `~/.takt/config.yaml` (global); it holds the active provider, provider
 * profiles (including permission modes), and other Takt settings.
 * @see https://github.com/nrslib/takt/blob/main/docs/configuration.md
 */
export const TAKT_CONFIG_FILE_NAME = "config.yaml";

/**
 * Takt's runtime provider config (Takt 0.56.0+). Lives at `.takt/runtime.yaml`
 * (project) and `~/.takt/runtime.yaml` (global), and owns provider/model/
 * provider-option assignment. Takt generates the global file on first launch,
 * so most installs have one; "runtime mode" only activates when its `provider:`
 * section carries an actual assignment.
 *
 * rulesync only ever READS this file: it resolves the active provider from it,
 * and it refuses to write the legacy `provider_options` key into `config.yaml`
 * while runtime mode is active (Takt hard-fails on that combination).
 * @see https://github.com/nrslib/takt/blob/main/docs/configuration.md
 */
export const TAKT_RUNTIME_CONFIG_FILE_NAME = "runtime.yaml";

/**
 * Top-level key in Takt's `config.yaml` holding the workflow MCP transport
 * allowlist (`stdio` / `sse` / `http` booleans). Takt is default-deny: a
 * transport must be explicitly enabled here before any workflow-defined MCP
 * server using it is permitted to run.
 * @see https://github.com/nrslib/takt/blob/main/docs/configuration.md
 */
export const TAKT_WORKFLOW_MCP_SERVERS_KEY = "workflow_mcp_servers";

/**
 * Top-level key in Takt's `config.yaml` holding the quality-gate overrides
 * (`quality_gates`, `quality_gates_edit_only`, and the `steps` / `personas`
 * scoped blocks). Takt merges project over global over the workflow YAML's own
 * gates, additively and deduped.
 * @see https://github.com/nrslib/takt/blob/main/docs/workflows.md
 */
export const TAKT_WORKFLOW_OVERRIDES_KEY = "workflow_overrides";
