import { join } from "node:path";

export const WARP_DIR = ".warp";
export const WARP_SKILLS_DIR_PATH = join(WARP_DIR, "skills");
export const WARP_LINUX_DIR = join(".config", "warp-terminal");
// Windows (Stable) settings live in `%LOCALAPPDATA%\warp\Warp\config`
// (i.e. AppData/Local ... /config), per Warp's documented file locations.
export const WARP_WIN32_DIR = join("AppData", "Local", "warp", "Warp", "config");
export const WARP_RULE_FILE_NAME = "AGENTS.md";
export const WARP_MCP_FILE_NAME = ".mcp.json";
export const WARP_PERMISSIONS_FILE_NAME = "settings.toml";
// Warp excludes files from agent codebase indexing/context via a project-scoped
// `.warpindexingignore` file (gitignore syntax) at the repository root.
// @see https://docs.warp.dev/agent-platform/capabilities/codebase-context/
export const WARP_IGNORE_FILE_NAME = ".warpindexingignore";
