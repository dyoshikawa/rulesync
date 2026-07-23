import { join } from "node:path";

import { AGENTSMD_DIR } from "./agentsmd-paths.js";

// Kimi Code (Moonshot AI) config layout. Project files live under `.kimi-code/`;
// global rules/subagents/skills follow the AGENTS open standard under `~/.agents/`
// (reusing AGENTSMD_DIR), while global MCP stays under `~/.kimi-code/`.
export const KIMI_DIR = ".kimi-code";
export const KIMI_RULE_FILE_NAME = "AGENTS.md";
export const KIMI_MCP_FILE_NAME = "mcp.json";

// Project scope
export const KIMI_SUBAGENTS_DIR_PATH = join(KIMI_DIR, "agents");
export const KIMI_SKILLS_DIR_PATH = join(KIMI_DIR, "skills");

// Global scope (AGENTS open standard, `.agents`)
export const KIMI_GLOBAL_SUBAGENTS_DIR_PATH = join(AGENTSMD_DIR, "agents");
export const KIMI_GLOBAL_SKILLS_DIR_PATH = join(AGENTSMD_DIR, "skills");
