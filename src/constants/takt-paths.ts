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
