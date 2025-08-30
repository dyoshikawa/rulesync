import { join } from "node:path";

export const RULESYNC_RULES_DIR = join(".rulesync", "rules");
export const RULESYNC_RULES_DIR_LEGACY = ".rulesync";
export const RULESYNC_IGNORE_FILE = ".rulesyncignore";
export const RULESYNC_MCP_FILE = join(".rulesync", ".mcp.json");
export const RULESYNC_COMMANDS_DIR = join(".rulesync", "commands");
export const RULESYNC_SUBAGENTS_DIR = join(".rulesync", "subagents");

export const CURSOR_MCP_FILE = join(".cursor", "mcp.json");
export const CLAUDECODE_MCP_FILE = ".mcp.json";
export const COPILOT_MCP_FILE = join(".vscode", "mcp.json");
export const CLINE_MCP_FILE = join(".cline", "mcp.json");
export const ROO_MCP_FILE = join(".roo", "mcp.json");
export const AMAZONQCLI_MCP_FILE = join(".amazonq", "mcp.json");
