import { join } from "node:path";

export const PI_DIR = ".pi";
const PI_AGENT_DIR = join(PI_DIR, "agent");
export const PI_AGENT_EXTENSIONS_DIR_PATH = join(PI_AGENT_DIR, "extensions");
export const PI_AGENT_PROMPTS_DIR_PATH = join(PI_AGENT_DIR, "prompts");
export const PI_AGENT_SKILLS_DIR_PATH = join(PI_AGENT_DIR, "skills");
export const PI_EXTENSIONS_DIR_PATH = join(PI_DIR, "extensions");
export const PI_PROMPTS_DIR_PATH = join(PI_DIR, "prompts");
export const PI_SKILLS_DIR_PATH = join(PI_DIR, "skills");
export const PI_RULE_FILE_NAME = "AGENTS.md";
// Pi's context-file discovery tries `AGENTS.override.md` first in every
// directory it scans, so it wins over a sibling `AGENTS.md` or `CLAUDE.md`
// deterministically (`loadContextFileFromDir` in
// `packages/coding-agent/src/core/resource-loader.ts`).
export const PI_RULE_OVERRIDE_FILE_NAME = "AGENTS.override.md";
export const PI_APPEND_SYSTEM_FILE_NAME = "APPEND_SYSTEM.md";
export const PI_HOOKS_FILE_NAME = "rulesync-hooks.ts";
