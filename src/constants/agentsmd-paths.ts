import { join } from "node:path";

export const AGENTSMD_DIR = ".agents";
export const AGENTSMD_MEMORIES_DIR_PATH = join(AGENTSMD_DIR, "memories");
export const AGENTSMD_COMMANDS_DIR_PATH = join(AGENTSMD_DIR, "commands");
export const AGENTSMD_SKILLS_DIR_PATH = join(AGENTSMD_DIR, "skills");
// Subagents are written to the cross-vendor `.agents/agents/` root, the one
// AGENTS.md-era clients actually scan (Antigravity discovers workspace agents
// there, and Kimi Code reads it alongside its own tree). Earlier rulesync
// versions wrote `.agents/subagents/`, a directory no documented client reads.
// @see https://antigravity.google/docs/subagents
export const AGENTSMD_SUBAGENTS_DIR_PATH = join(AGENTSMD_DIR, "agents");
export const AGENTSMD_RULE_FILE_NAME = "AGENTS.md";
