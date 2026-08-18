# Supported Tools and Features

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

<!-- SUPPORTED_TOOLS_DOCS:BEGIN -->

| Tool                      | --targets          | rules | ignore |   mcp    | commands | subagents | skills | hooks | permissions | checks |
| ------------------------- | ------------------ | :---: | :----: | :------: | :------: | :-------: | :----: | :---: | :---------: | :----: |
| AGENTS.md                 | agentsmd           |  ✅   |        |          |    🎮    |    🎮     |   🎮   |       |             |        |
| AgentsSkills              | agentsskills       |       |        |          |          |           | ✅ 🌏  |       |             |        |
| Amp                       | amp                | ✅ 🌏 |        |  ✅ 🌏   |          |           | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    | ✅ 🌏  |
| Claude Code               | claudecode         | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Claude Code plugin        | claudecode-plugin  |       |        |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |             |        |
| Codex CLI                 | codexcli           | ✅ 🌏 |        | ✅ 🌏 🔧 |    🌏    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| GitHub Copilot            | copilot            | ✅ 🌏 |        |    ✅    |    ✅    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |        |
| GitHub Copilot CLI        | copilotcli         | ✅ 🌏 |        | ✅ 🌏 🔧 |          |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Goose                     | goose              | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   |   ✅   | ✅ 🌏 |     🌏      |        |
| Hermes Agent              | hermesagent        |  ✅   |   ✅   |  🌏 🔧   |    🌏    |   ✅ 🌏   |   🌏   |  🌏   |     🌏      |   ✅   |
| Grok CLI                  | grokcli            | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Cursor                    | cursor             |  ✅   |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |   ✅   |
| deepagents-cli            | deepagents         | ✅ 🌏 |        | ✅ 🌏 🔧 |          |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |             |        |
| Factory Droid             | factorydroid       | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| OpenCode                  | opencode           | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Cline                     | cline              | ✅ 🌏 |   ✅   |    🌏    |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |        |
| Kilo Code                 | kilo               | ✅ 🌏 |   ✅   | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Kimi Code                 | kimi-code          | ✅ 🌏 |        | ✅ 🌏 🔧 |          |   ✅ 🌏   | ✅ 🌏  |  🌏   |     🌏      |        |
| Roo Code ⚠️               | roo                | ✅ 🌏 |   ✅   |  ✅ 🔧   |  ✅ 🌏   |    ✅     | ✅ 🌏  |       |             |        |
| Zoo Code                  | zoocode            | ✅ 🌏 |   ✅   |  ✅ 🔧   |  ✅ 🌏   |    ✅     | ✅ 🌏  |       |     ✅      |        |
| Rovodev (Atlassian)       | rovodev            | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |    ✅ 🌏    |   ✅   |
| Takt                      | takt               | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |    ✅ 🌏    | ✅ 🌏  |
| Vibe Code                 | vibe               | ✅ 🌏 |   ✅   | ✅ 🌏 🔧 |          |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Qwen Code                 | qwencode           | ✅ 🌏 |   ✅   | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Meta Muse Code            | musecode           |  ✅   |        |    🌏    |          |           | ✅ 🌏  |       |             |        |
| Reasonix                  | reasonix           | ✅ 🌏 | ✅ 🌏  |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Kiro ⚠️                   | kiro               | ✅ 🌏 | ✅ 🌏  | ✅ 🌏 🔧 |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |        |
| Kiro CLI                  | kiro-cli           | ✅ 🌏 | ✅ 🌏  | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |        |
| Kiro IDE                  | kiro-ide           | ✅ 🌏 | ✅ 🌏  | ✅ 🌏 🔧 |    ✅    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |        |
| Google Antigravity IDE    | antigravity-ide    | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |        |
| Google Antigravity CLI    | antigravity-cli    | ✅ 🌏 |   ✅   | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     🌏      |        |
| Google Antigravity plugin | antigravity-plugin |  ✅   |        |  ✅ 🔧   |          |    ✅     |   ✅   |  ✅   |             |        |
| JetBrains AI Assistant    | aiassistant        |  ✅   |   ✅   |  ✅ 🌏   |          |           |   ✅   |       |             |        |
| JetBrains Junie           | junie              | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |  🌏   |     🌏      |        |
| AugmentCode               | augmentcode        | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |   ✅   |
| Devin Desktop             | devin              | ✅ 🌏 | ✅ 🌏  | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Warp                      | warp               | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |           | ✅ 🌏  |       |     🌏      |        |
| Replit                    | replit             |  ✅   |        |          |          |           | ✅ 🌏  |       |             |        |
| Pi Coding Agent           | pi                 | ✅ 🌏 |        |          |  ✅ 🌏   |           | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |        |
| Zed                       | zed                | ✅ 🌏 | ✅ 🌏  |  ✅ 🌏   |          |           | ✅ 🌏  |       |    ✅ 🌏    |        |

<!-- SUPPORTED_TOOLS_DOCS:END -->

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)
- ⚠️: Deprecated — still supported, but see the note below

## Hermes Agent compatibility

The `hermesagent` target is validated against Hermes Agent v0.20.2 (release
`v2026.8.16`). The supported contract covers project rules, ignore patterns,
subagents, and checks, plus global MCP servers, commands, subagents, skills,
hooks, and permissions. Generation, `--check`, and import round-trips are
covered for both advertised scopes.

Rulesync honors Hermes profiles through `HERMES_HOME`. When it is set, its value
is the profile root itself: global configuration is read and written directly
under `$HERMES_HOME` (`config.yaml`, `skills/`, `plugins/`, and `rulesync/`),
without appending `.hermes`. When it is unset, Rulesync follows Hermes's own
platform default: `~/.hermes` everywhere except Windows, where it is
`%LOCALAPPDATA%\hermes`. Because `HERMES_HOME` names where Hermes itself reads
the profile, it also takes precedence over `--output-roots` in global scope.
Project-scoped paths remain rooted in the project.

Changing which profile root Rulesync resolves strands whatever it generated
under the previous one. `--delete` reconciles only the root resolved for the
current run, so files under a root it no longer resolves are invisible to it and
must be removed by hand once you are sure Hermes no longer reads them. This
applies whenever you set or change `HERMES_HOME`, and to two upgrades that moved
the resolved root on their own: before v16.0.0 global files went to `~/.hermes`
even when `HERMES_HOME` was set, and before v16.2.0 they went there on Windows
too, rather than to `%LOCALAPPDATA%\hermes`.

Project plugins are registered by adding their names to
`$HERMES_HOME/config.yaml`, but Rulesync does not persist Hermes's global
project-plugin trust gate. Run Hermes from a trusted project root with
`HERMES_ENABLE_PROJECT_PLUGINS=true` for an explicit, session-scoped opt-in. A
future Hermes release that changes its loaders, schemas, or plugin API requires
a new compatibility validation.

## Deprecation notes

- **Google Antigravity (`antigravity-ide` / `antigravity-cli`)** — Antigravity 2.0 splits into two products: the desktop **`antigravity-ide`** and the **`antigravity-cli`** (`agy`). As of Antigravity 2.0 the IDE reads its global MCP config and skills from the shared `~/.gemini/config/` tree — `~/.gemini/config/mcp_config.json` and `~/.gemini/config/skills/`, matching the current [MCP](https://antigravity.google/docs/mcp) and [Skills](https://antigravity.google/docs/skills) docs. The `antigravity-cli` global MCP config also lives in the shared `~/.gemini/config/mcp_config.json`, while the CLI keeps its own global skills tree at `~/.gemini/antigravity-cli/skills/`. Both targets also intentionally **share** the global rule file `~/.gemini/GEMINI.md` and the global hooks file `~/.gemini/config/hooks.json` — enabling both targets in `--global` mode writes those shared files once. For project-scope rules, **both `antigravity-ide` and `antigravity-cli`** emit the root rule as a plain cross-tool **`AGENTS.md`** at the project root (the Gemini-lineage discovery order is `AGENTS.md`, `CONTEXT.md`, `GEMINI.md`; the IDE has read `AGENTS.md` since v1.20.3) and non-root rules under `.agents/rules/` (the IDE adds trigger frontmatter to non-root rules; the CLI keeps them as plain markdown). For **commands (workflows)**, both targets share the project `.agents/workflows/` directory (invoked as `/workflow-name`); in `--global` mode the IDE writes to `~/.gemini/antigravity/global_workflows/` while the CLI keeps its own `~/.gemini/antigravity-cli/global_workflows/` tree (mirroring the CLI's global skills tree).
- **Kiro (`kiro`)** — Kiro ships as two products with diverging config formats: the **Kiro IDE** reads Markdown subagents (`.kiro/agents/*.md`) and structured JSON hooks (`.kiro/hooks/*.json`, format `{ "version": "v1", "hooks": [ ... ] }`), while the **Kiro CLI** reads JSON agent-config subagents (`.kiro/agents/*.json`). A single target cannot emit both subagent shapes faithfully, so `kiro` is split into **`kiro-cli`** and **`kiro-ide`**. The legacy `kiro` target is kept as a **deprecated alias** (its current mixed output is unchanged for backward compatibility). Shared surfaces (steering rules with `inclusion`, `.kiro/settings/mcp.json`, `.kiro/prompts/` commands, `.kiro/skills/`, `.kiroignore`, permissions) are identical between the two; they differ only in **subagents** (`.md` vs `.json`). **Hooks** are the same for both: a single `.kiro/hooks/rulesync.json` (whose `hooks` array holds every generated hook) in both project (`.kiro/hooks/`) and global (`~/.kiro/hooks/`) scope, mapping canonical lifecycle events to Kiro's PascalCase triggers (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) and supporting both `agent` (prompt) and `command` actions. Kiro CLI 3.0 [migrated to that format](https://kiro.dev/docs/cli/v3/hooks-migration/) and no longer reads the embedded agent hooks in `.kiro/agents/default.json`, which only the deprecated `kiro` alias still writes (including `cacheTtl` ⇄ `cache_ttl_seconds`). Global **skills** (`~/.kiro/skills/`), global **ignore** (`~/.kiro/settings/kiroignore`), and global Kiro IDE **subagents** (`~/.kiro/agents/`) are also supported, as are global Kiro CLI **commands** (`~/.kiro/prompts/`) and **subagents** (`~/.kiro/agents/`). Kiro's shared MCP file preserves per-server `disabledTools`.
- **Roo Code (`roo`)** — Roo Code is end of life: its final release was **v3.54.0 (2026-05-15)** and the [Roo-Code repository](https://github.com/RooCodeInc/Roo-Code) is archived, so nothing about the target will move again. New projects should target **`zoocode`** instead — [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code) is the community continuation named by the Roo shutdown notice, and it continues Roo's release numbering. The `roo` target stays supported because Zoo Code still reads the `.roo/` project tree and `~/.roo` global tree verbatim, so existing `roo` output keeps working; what it no longer tracks is anything Zoo Code added after the fork. The two targets write the same files, so enable one per project rather than both — see the Zoo Code note in [File formats](./file-formats.md) for the fail-open hazard a `--targets roo` generate creates in a shared `.roomodes`.
