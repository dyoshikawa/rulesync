import { join } from "node:path";

export const CLINE_DIR = ".cline";
export const CLINERULES_DIR = ".clinerules";
export const CLINE_COMMANDS_DIR_PATH = join(CLINERULES_DIR, "workflows");
export const CLINE_COMMANDS_GLOBAL_DIR_PATH = join("Documents", "Cline", "Workflows");
export const CLINE_SKILLS_DIR_PATH = join(CLINE_DIR, "skills");
export const CLINE_AGENTS_DIR_PATH = join(CLINE_DIR, "agents");
export const CLINE_MCP_DIR_PATH = join(CLINE_DIR, "data", "settings");
export const CLINE_MCP_FILE_NAME = "cline_mcp_settings.json";
export const CLINE_PERMISSIONS_DIR_PATH = CLINE_DIR;
export const CLINE_PERMISSIONS_FILE_NAME = "command-permissions.json";
export const CLINE_IGNORE_FILE_NAME = ".clineignore";
