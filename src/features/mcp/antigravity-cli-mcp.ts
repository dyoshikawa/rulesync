import { AntigravityMcp } from "./antigravity-mcp.js";

/**
 * MCP generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravityMcp}. The CLI reads its global MCP
 * config from the shared `~/.gemini/config/mcp_config.json` location (the legacy
 * `~/.gemini/antigravity-cli/mcp_config.json` path is no longer read by the CLI).
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/config/mcp_config.json`
 */
export class AntigravityCliMcp extends AntigravityMcp {
  protected static override getGlobalSubdir(): string {
    return "config";
  }
}
