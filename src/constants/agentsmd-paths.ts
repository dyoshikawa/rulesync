import { join } from "node:path";

export const AGENTSMD_DIR = ".agents";
export const AGENTSMD_MEMORIES_DIR_PATH = join(AGENTSMD_DIR, "memories");
export const AGENTSMD_COMMANDS_DIR_PATH = join(AGENTSMD_DIR, "commands");
export const AGENTSMD_SKILLS_DIR_PATH = join(AGENTSMD_DIR, "skills");
export const AGENTSMD_SUBAGENTS_DIR_PATH = join(AGENTSMD_DIR, "subagents");
export const AGENTSMD_RULE_FILE_NAME = "AGENTS.md";
