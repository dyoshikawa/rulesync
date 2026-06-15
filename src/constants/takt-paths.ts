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
