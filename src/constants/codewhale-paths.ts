import { join } from "node:path";

// Codewhale keeps its project-scoped assets under a `.codewhale/` directory at
// the workspace root and its user-scoped configuration under `~/.codewhale/`.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
export const CODEWHALE_DIR = ".codewhale";

// Rules. The workspace-root `AGENTS.md` is the canonical project instruction
// file, and every `.codewhale/rules/*.md` file is loaded after it in filename
// order. The user-scoped `~/.codewhale/AGENTS.md` is always loaded and
// prepended to the project instructions; there is no user-scoped rules
// directory.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
// @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/project_context.rs
export const CODEWHALE_RULE_FILE_NAME = "AGENTS.md";
export const CODEWHALE_RULES_DIR_NAME = "rules";

// Skills: `<name>/SKILL.md` directories under `.codewhale/skills/` and
// `~/.codewhale/skills/`.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/SKILLS.md
export const CODEWHALE_SKILLS_DIR_PATH = join(CODEWHALE_DIR, "skills");

// Subagents: TOML agent profiles under `.codewhale/agents/` and
// `~/.codewhale/agents/`.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/SUBAGENTS.md
// @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/fleet/profile.rs
export const CODEWHALE_AGENTS_DIR_PATH = join(CODEWHALE_DIR, "agents");

// Commands: Markdown slash commands under `.codewhale/commands/` and
// `~/.codewhale/commands/`. The directory is scanned flat; the lowercased file
// stem is the command name unless frontmatter `name` replaces it.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/architecture/command-dispatch.md
// @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/commands/user_commands.rs
export const CODEWHALE_COMMANDS_DIR_PATH = join(CODEWHALE_DIR, "commands");

// Hooks. The project file `.codewhale/hooks.toml` carries top-level
// `[[hooks]]` entries only; the user file `~/.codewhale/config.toml` carries a
// `[hooks]` table (with `[[hooks.hooks]]` entries) beside unrelated settings.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/HOOKS.md
export const CODEWHALE_HOOKS_FILE_NAME = "hooks.toml";
export const CODEWHALE_CONFIG_FILE_NAME = "config.toml";

// MCP servers: `~/.codewhale/mcp.json` for the user and `.codewhale/mcp.json`
// in the workspace; the workspace file is honored only once the workspace is
// trusted, and its servers override same-named user servers.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/MCP.md
// @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/mcp.rs
export const CODEWHALE_MCP_FILE_NAME = "mcp.json";

// Permissions: typed `[[rules]]` records in `~/.codewhale/permissions.toml`, the
// sibling of the user `config.toml`. It is the only permission-rule source;
// there is no project-local `permissions.toml`.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/AUTHORIZATION_ORDER.md
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
export const CODEWHALE_PERMISSIONS_FILE_NAME = "permissions.toml";
