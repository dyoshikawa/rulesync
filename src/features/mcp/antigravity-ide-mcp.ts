import { ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR } from "../../constants/antigravity-ide-paths.js";
import { AntigravityMcp } from "./antigravity-mcp.js";

/**
 * MCP generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravityMcp}. As of Antigravity 2.0 the
 * IDE reads its global MCP config from the shared `~/.gemini/config/mcp_config.json`
 * location (the same `~/.gemini/config/` tree already used for global hooks),
 * matching the CLI; the legacy `~/.gemini/antigravity/mcp_config.json` path is
 * no longer read.
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/config/mcp_config.json`
 */
export class AntigravityIdeMcp extends AntigravityMcp {
  protected static override getGlobalSubdir(): string {
    return ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR;
  }
}
