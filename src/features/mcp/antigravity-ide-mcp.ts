import { AntigravityMcp } from "./antigravity-mcp.js";

/**
 * MCP generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravityMcp}; the IDE keeps its own global
 * config tree at `~/.gemini/antigravity/mcp_config.json`.
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/antigravity/mcp_config.json`
 */
export class AntigravityIdeMcp extends AntigravityMcp {
  protected static override getGlobalSubdir(): string {
    return "antigravity";
  }
}
