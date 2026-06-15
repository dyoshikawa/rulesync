import { join } from "node:path";

export const GEMINICLI_DIR = ".gemini";
export const GEMINICLI_MEMORIES_DIR_NAME = "memories";
export const GEMINICLI_COMMANDS_DIR_PATH = join(GEMINICLI_DIR, "commands");
export const GEMINICLI_SKILLS_DIR_PATH = join(GEMINICLI_DIR, "skills");
export const GEMINICLI_AGENTS_DIR_PATH = join(GEMINICLI_DIR, "agents");
export const GEMINICLI_POLICIES_DIR_PATH = join(GEMINICLI_DIR, "policies");
export const GEMINICLI_MCP_FILE_NAME = "settings.json";
export const GEMINICLI_HOOKS_FILE_NAME = "settings.json";
export const GEMINICLI_IGNORE_FILE_NAME = ".geminiignore";
export const GEMINICLI_RULE_FILE_NAME = "GEMINI.md";
export const GEMINICLI_PERMISSIONS_FILE_NAME = "rulesync.toml";
