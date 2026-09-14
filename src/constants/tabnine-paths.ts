import { join } from "node:path";

// Tabnine CLI keeps every agent asset under `.tabnine/agent/` (project scope,
// relative to the project root) and `~/.tabnine/agent/` (user scope). The
// Tabnine IDE agent shares the parent `.tabnine/` directory for its own
// files (guidelines, IDE-agent skills), so the two products can coexist in
// one tree.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
export const TABNINE_DIR = ".tabnine";
export const TABNINE_AGENT_DIR_PATH = join(TABNINE_DIR, "agent");

// Rules. Tabnine CLI loads `TABNINE.md` from the project root as its
// hierarchical memory file (`/init` scaffolds it, `/memory reload` re-reads
// it). Global rules are not documented for the CLI; rulesync writes the user
// copy to `~/.tabnine/agent/TABNINE.md` next to the other user-scoped agent
// assets. Guideline files under `.tabnine/guidelines/` (project) and
// `~/.tabnine/guidelines/` (user) are picked up by the Tabnine IDE agent; the
// CLI does not auto-load them, so rulesync lists them from `TABNINE.md`.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
// @see https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines
export const TABNINE_RULE_FILE_NAME = "TABNINE.md";
export const TABNINE_GUIDELINES_DIR_PATH = join(TABNINE_DIR, "guidelines");

// Ignore: a gitignore-syntax `.tabnineignore` at the project root, honored
// while `context.fileFiltering.respectGeminiIgnore` is enabled (the default).
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
export const TABNINE_IGNORE_FILE_NAME = ".tabnineignore";

// Settings: `<project>/.tabnine/agent/settings.json` (project) and
// `~/.tabnine/agent/settings.json` (user). The file holds the `mcpServers`
// map, the `hooks` map and the `tools.allowed` / `tools.exclude` lists next
// to other user-managed keys, so rulesync merges its keys into the file
// instead of overwriting it.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/hooks
export const TABNINE_SETTINGS_FILE_NAME = "settings.json";

// Slash commands: TOML files under `<project>/.tabnine/agent/commands/` and
// `~/.tabnine/agent/commands/`; the relative path becomes the command name
// (`ns/name.toml` → `/ns:name`).
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/commands
export const TABNINE_COMMANDS_DIR_PATH = join(TABNINE_AGENT_DIR_PATH, "commands");

// Subagents: Markdown files with frontmatter under
// `<project>/.tabnine/agent/agents/` and `~/.tabnine/agent/agents/`.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/subagents
export const TABNINE_AGENTS_DIR_PATH = join(TABNINE_AGENT_DIR_PATH, "agents");

// Skills: Anthropic-style `<name>/SKILL.md` directories under
// `<project>/.tabnine/agent/skills/` and `~/.tabnine/agent/skills/`.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/agent-skills
export const TABNINE_SKILLS_DIR_PATH = join(TABNINE_AGENT_DIR_PATH, "skills");
