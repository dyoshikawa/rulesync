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

/** Skills directory under `.grok/` (project: `./.grok/skills`, global: `~/.grok/skills`). */
export const GROKCLI_SKILLS_DIR_PATH = join(GROKCLI_DIR, "skills");

/**
 * Subagents (agent profiles) directory under `.grok/`. Grok Build discovers
 * agent definitions from `.grok/agents/*.md` (project) and `~/.grok/agents/*.md`
 * (global), each a Markdown file with YAML frontmatter (verified via
 * `grok inspect`; format matches the bundled `~/.grok/bundled/agents/*.md`).
 */
export const GROKCLI_AGENTS_DIR_PATH = join(GROKCLI_DIR, "agents");

/** Instruction file. Grok reads the AGENTS.md instruction-file family natively. */
export const GROKCLI_RULE_FILE_NAME = "AGENTS.md";
