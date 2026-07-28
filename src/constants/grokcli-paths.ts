import { join } from "node:path";

/**
 * Grok Build CLI (xAI) configuration-layout conventions.
 *
 * Single source of truth for where Grok Build expects its files. Grok Build
 * stores MCP servers (and other settings) in a `config.toml` under `.grok/`,
 * with project/global scopes resolved by the directory the CLI runs in
 * (`./.grok/config.toml` vs `~/.grok/config.toml`).
 *
 * Verified against `grok` 0.2.54 (`grok mcp add --help`, `grok mcp add`):
 * `-s project` writes `./.grok/config.toml`, `-s user` writes
 * `~/.grok/config.toml`, both as a TOML `[mcp_servers.<name>]` table.
 * @see https://docs.x.ai/build/overview
 */

/** Root directory for Grok Build configuration, relative to the scope root. */
export const GROKCLI_DIR = ".grok";

/** MCP servers and other settings live in `config.toml` under `.grok/`. */
export const GROKCLI_MCP_FILE_NAME = "config.toml";

/**
 * Shared Grok CLI config file (`config.toml`). MCP servers, the `[ui]`
 * permission mode, and other settings all live here; permissions reuse the same
 * file name as MCP since Grok consolidates everything into one config.
 */
export const GROKCLI_CONFIG_FILE_NAME = "config.toml";

/** Skills directory under `.grok/` (project: `./.grok/skills`, global: `~/.grok/skills`). */
export const GROKCLI_SKILLS_DIR_PATH = join(GROKCLI_DIR, "skills");

/**
 * Hooks directory under `.grok/`. Grok Build discovers hook config files from
 * `.grok/hooks/*.json` (project) and `~/.grok/hooks/*.json` (global), each a
 * standalone JSON file using the Claude-Code-compatible nested `{ hooks: { … } }`
 * shape. rulesync writes all its hooks into a single `rulesync.json`.
 * @see https://docs.x.ai/build/features/hooks
 */
export const GROKCLI_HOOKS_DIR_PATH = join(GROKCLI_DIR, "hooks");

/** rulesync-managed Grok hooks file under `.grok/hooks/`. */
export const GROKCLI_HOOKS_FILE_NAME = "rulesync.json";

/**
 * Subagents (agent profiles) directory under `.grok/`. Grok Build discovers
 * agent definitions from `.grok/agents/*.md` (project) and `~/.grok/agents/*.md`
 * (global), each a Markdown file with YAML frontmatter (verified via
 * `grok inspect`; format matches the bundled `~/.grok/bundled/agents/*.md`).
 */
export const GROKCLI_AGENTS_DIR_PATH = join(GROKCLI_DIR, "agents");

/**
 * Instruction file. Grok reads the AGENTS.md instruction-file family natively,
 * including the user-level `~/.grok/AGENTS.md` for global rules (verified via
 * `grok inspect`, consistent with the `.grok/` global discovery used by the
 * MCP/skills/subagents adapters).
 */
export const GROKCLI_RULE_FILE_NAME = "AGENTS.md";

/**
 * Non-root rules directory. Grok scans `*.md` here — flat, sorted by name —
 * alongside the AGENTS.md family: `.grok/rules/` in each project directory it
 * walks, and `~/.grok/rules/` in the home scope.
 * @see https://docs.x.ai/build/overview
 */
export const GROKCLI_RULES_DIR_PATH = join(GROKCLI_DIR, "rules");
