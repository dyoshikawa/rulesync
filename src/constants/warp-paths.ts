import { join } from "node:path";

export const WARP_DIR = ".warp";
export const WARP_SKILLS_DIR_PATH = join(WARP_DIR, "skills");
export const WARP_LINUX_DIR = join(".config", "warp-terminal");
// Windows (Stable) settings live in `%LOCALAPPDATA%\warp\Warp\config`
// (i.e. AppData/Local ... /config), per Warp's documented file locations.
export const WARP_WIN32_DIR = join("AppData", "Local", "warp", "Warp", "config");
// The standalone Warp Agent CLI (`warp` binary) keeps its own config root,
// separate from the Warp app's, holding both its `settings.toml` and its
// global `.mcp.json`: a sibling `~/.warp_cli` on macOS and a `cli`
// subdirectory of the app's config dir elsewhere (`tui_config_local_dir` in
// the Warp repository's `crates/warp_core/src/paths.rs`).
// @see https://docs.warp.dev/agents/cli/configuration/
export const WARPCLI_DIR = ".warp_cli";
export const WARPCLI_LINUX_DIR = join(WARP_LINUX_DIR, "cli");
export const WARPCLI_WIN32_DIR = join(WARP_WIN32_DIR, "cli");

/**
 * The Warp Agent CLI's config root, relative to the home directory (the
 * processor resolves the home directory through `outputRoot`).
 *
 * - macOS: `~/.warp_cli`
 * - Linux: `~/.config/warp-terminal/cli`
 * - Windows: `%LOCALAPPDATA%\warp\Warp\config\cli` (`%LOCALAPPDATA%` is
 *   `~/AppData/Local`)
 *
 * @see https://docs.warp.dev/agents/cli/configuration/
 */
export function warpcliConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return WARPCLI_DIR;
    case "win32":
      return WARPCLI_WIN32_DIR;
    default:
      return WARPCLI_LINUX_DIR;
  }
}

export const WARP_RULE_FILE_NAME = "AGENTS.md";
// Warp reads a global rules file from `~/.agents/AGENTS.md` (the cross-tool
// agent config directory), alongside project rules and Warp Drive rules.
// @see https://docs.warp.dev/terminal/settings/file-locations/
export const WARP_GLOBAL_RULE_DIR = ".agents";
export const WARP_MCP_FILE_NAME = ".mcp.json";
export const WARP_PERMISSIONS_FILE_NAME = "settings.toml";
// Warp excludes files from agent codebase indexing/context via a project-scoped
// `.warpindexingignore` file (gitignore syntax) at the repository root.
// @see https://docs.warp.dev/agent-platform/capabilities/codebase-context/
export const WARP_IGNORE_FILE_NAME = ".warpindexingignore";
