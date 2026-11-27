/**
 * OpenHands configuration-layout conventions.
 *
 * Rules and skills are not written here: OpenHands already reads the shared
 * `AGENTS.md` and `.agents/skills/` files the `agentsmd` and `agentsskills`
 * targets write.
 */
export const OPENHANDS_DIR = ".openhands";

// Hooks: `.openhands/hooks.json` in the conversation's working folder (the
// repository root). OpenHands does not search parent folders and documents no
// user-level hooks file.
// @see https://docs.openhands.dev/openhands/usage/customization/hooks
export const OPENHANDS_HOOKS_FILE_NAME = "hooks.json";

// MCP: `~/.openhands/mcp.json` (user scope only), an `mcpServers` object in the
// FastMCP configuration format.
// @see https://docs.openhands.dev/openhands/usage/cli/mcp-servers
export const OPENHANDS_MCP_FILE_NAME = "mcp.json";
