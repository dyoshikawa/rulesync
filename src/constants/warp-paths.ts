import { join } from "node:path";

export const WARP_DIR = ".warp";
export const WARP_SKILLS_DIR_PATH = join(WARP_DIR, "skills");
export const WARP_LINUX_DIR = join(".config", "warp-terminal");
export const WARP_WIN32_DIR = join("AppData", "Roaming", "warp", "Warp", "data");
export const WARP_RULE_FILE_NAME = "AGENTS.md";
export const WARP_MCP_FILE_NAME = ".mcp.json";
export const WARP_PERMISSIONS_FILE_NAME = "settings.toml";
