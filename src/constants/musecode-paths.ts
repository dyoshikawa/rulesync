import { join } from "node:path";

// Meta Muse Code (terminal coding agent, beta since 2026-08-05).
// https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2
// https://dev.meta.ai/docs/muse-code

// Muse Code walks up from the working directory to the `.git` boundary and
// loads one instruction file per directory level, preferring `AGENTS.md` over
// `CLAUDE.md` when both exist. rulesync emits only the project-root `AGENTS.md`
// (shared with the agentsmd/codexcli targets). User/global rules exist in Muse
// Code, but the docs do not state their path, so no global rules location is
// emitted. https://dev.meta.ai/docs/muse-code/configuration.md
export const MUSECODE_RULE_FILE_NAME = "AGENTS.md";

// Project skills follow the Agent Skills layout at
// `.agents/skills/<skill-id>/SKILL.md`. Muse Code also scans repo-local
// `.codex/skills` and `.claude/skills` for compatibility, but those belong to
// other tools and are deliberately not emitted for musecode.
// https://dev.meta.ai/docs/muse-code/extending.md
export const MUSECODE_SKILLS_DIR_PATH = join(".agents", "skills");

// Muse Code's global config directory. User skills load from
// `$XDG_CONFIG_HOME/muse/skills` (and `~/.agents/skills`); rulesync emits only
// the XDG-default `~/.config/muse/skills` so a skill is written exactly once.
// https://dev.meta.ai/docs/muse-code/extending.md
export const MUSECODE_GLOBAL_CONFIG_DIR_PATH = join(".config", "muse");
export const MUSECODE_GLOBAL_SKILLS_DIR_PATH = join(MUSECODE_GLOBAL_CONFIG_DIR_PATH, "skills");

// Deliberately NOT emitted: committed project memory at `<repo>/.agents/memory/`
// (an `MEMORY.md` index plus one Markdown file per topic). It is agent-maintained
// durable memory rather than an author-written instruction file, and rulesync has
// no canonical memory dimension to map onto, so it stays out of scope. If it is
// ever brought in scope, note that Muse Code injects `MEMORY.md` even in an
// untrusted workspace — unlike rules, skills and hooks — so anything written there
// reaches the model context before any trust decision.
// https://dev.meta.ai/docs/muse-code/configuration.md

// User settings file. Holds the `mcp_servers` block (Muse Code documents no
// project-scoped MCP location) and MUST carry `"schema_version": 1` — a
// settings.json without that key fails every command at startup with
// `malformed settings file`. https://dev.meta.ai/docs/muse-code/configuration.md
export const MUSECODE_SETTINGS_FILE_NAME = "settings.json";
export const MUSECODE_SETTINGS_SCHEMA_VERSION = 1;
