import { join } from "node:path";

export const KIMI_CODE_DIR = ".kimi-code";
export const KIMI_CODE_RULE_FILE_NAME = "AGENTS.md";
export const KIMI_CODE_MCP_FILE_NAME = "mcp.json";
export const KIMI_CODE_CONFIG_FILE_NAME = "config.toml";
export const KIMI_CODE_SKILLS_DIR_PATH = join(KIMI_CODE_DIR, "skills");
export const KIMI_CODE_AGENTS_DIR_PATH = join(KIMI_CODE_DIR, "agents");
export const KIMI_CODE_SHARED_SKILLS_DIR_PATH = join(".agents", "skills");
export const KIMI_CODE_SHARED_AGENTS_DIR_PATH = join(".agents", "agents");
