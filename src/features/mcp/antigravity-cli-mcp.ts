import { AntigravityMcp } from "./antigravity-mcp.js";

/**
 * MCP generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravityMcp}; the CLI keeps its own global
 * config tree at `~/.gemini/antigravity-cli/mcp_config.json`.
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/antigravity-cli/mcp_config.json`
 */
export class AntigravityCliMcp extends AntigravityMcp {
  protected static override getGlobalSubdir(): string {
    return "antigravity-cli";
  }
}
