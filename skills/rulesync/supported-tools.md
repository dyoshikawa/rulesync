# Supported Tools and Features

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool                   | --targets       | rules | ignore |   mcp    | commands | subagents | skills | hooks | permissions |
| ---------------------- | --------------- | :---: | :----: | :------: | :------: | :-------: | :----: | :---: | :---------: |
| AGENTS.md              | agentsmd        |  ✅   |        |          |    🎮    |    🎮     |   🎮   |       |             |
| AgentsSkills           | agentsskills    |       |        |          |          |           | ✅ 🌏  |       |             |
| Amp                    | amp             | ✅ 🌏 |        |  ✅ 🌏   |          |           | ✅ 🌏  |       |    ✅ 🌏    |
| Claude Code            | claudecode      | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Codex CLI              | codexcli        | ✅ 🌏 |        | ✅ 🌏 🔧 |    🌏    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Gemini CLI ⚠️          | geminicli       | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |    ✅     | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| GitHub Copilot         | copilot         | ✅ 🌏 |        |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |             |
| GitHub Copilot CLI     | copilotcli      | ✅ 🌏 |        |  ✅ 🌏   |          |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |             |
| Goose                  | goose           | ✅ 🌏 |   ✅   |    🌏    |  ✅ 🌏   |   ✅ 🌏   |        | ✅ 🌏 |             |
| Cursor                 | cursor          |  ✅   |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| deepagents-cli         | deepagents      | ✅ 🌏 |        |  ✅ 🌏   |          |   ✅ 🌏   | ✅ 🌏  |  🌏   |             |
| Factory Droid          | factorydroid    | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| OpenCode               | opencode        | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Cline                  | cline           | ✅ 🌏 |   ✅   |    🌏    |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |     ✅      |
| Kilo Code              | kilo            | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Roo Code               | roo             |  ✅   |   ✅   |    ✅    |    ✅    |    🎮     | ✅ 🌏  |       |             |
| Rovodev (Atlassian)    | rovodev         | ✅ 🌏 |        |    🌏    |          |   ✅ 🌏   | ✅ 🌏  |       |     🌏      |
| Takt                   | takt            | ✅ 🌏 |        |          |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |             |
| Vibe Code              | vibe            | ✅ 🌏 |   ✅   |  ✅ 🌏   |          |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Qwen Code              | qwencode        |  ✅   |   ✅   |          |          |           |        |       |    ✅ 🌏    |
| Kiro ⚠️                | kiro            |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Kiro CLI               | kiro-cli        |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Kiro IDE               | kiro-ide        |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |       |     ✅      |
| Google Antigravity IDE | antigravity-ide | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |           | ✅ 🌏  | ✅ 🌏 |     ✅      |
| Google Antigravity CLI | antigravity-cli | ✅ 🌏 |   ✅   | ✅ 🌏 🔧 |          |           | ✅ 🌏  | ✅ 🌏 |     🌏      |
| Google Antigravity ⚠️  | antigravity     |  ✅   |        |          |    ✅    |           | ✅ 🌏  |       |             |
| JetBrains Junie        | junie           | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |  🌏   |             |
| AugmentCode            | augmentcode     | ✅ 🌏 |   ✅   |    🌏    |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Devin Desktop          | devin           | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |             |
| Warp                   | warp            |  ✅   |        |  ✅ 🌏   |          |           | ✅ 🌏  |       |     🌏      |
| Replit                 | replit          |  ✅   |        |          |          |           | ✅ 🌏  |       |             |
| Pi Coding Agent        | pi              | ✅ 🌏 |        |          |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Zed                    | zed             | ✅ 🌏 |   ✅   |  ✅ 🌏   |          |           | ✅ 🌏  |       |    ✅ 🌏    |

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)
- ⚠️: Deprecated — still supported, but see the note below

## Deprecation notes

- **Gemini CLI (`geminicli`)** — Google is retiring Gemini CLI on **June 18, 2026**, when it stops serving requests for Google AI Pro/Ultra and free Gemini Code Assist for individuals (Enterprise plans are unaffected). The successor is the **Antigravity CLI (`antigravity-cli`)**. `geminicli` is **not** removed from rulesync — Enterprise access continues and existing `GEMINI.md`/`.gemini/` repositories still rely on it — but new projects should prefer `antigravity-cli`. See the [Gemini CLI → Antigravity CLI migration guide](../guide/geminicli-to-antigravity-cli.md).
- **Google Antigravity (`antigravity`)** — Antigravity 2.0 splits into two products: the desktop **`antigravity-ide`** and the **`antigravity-cli`** (`agy`). The legacy `antigravity` target is now a **deprecated alias for `antigravity-ide`** that keeps its original `.agent/` (singular) paths for backward compatibility. Migrate to `antigravity-ide` (desktop IDE) or `antigravity-cli` (CLI). As of Antigravity 2.0 the IDE reads its global MCP config and skills from the shared `~/.gemini/config/` tree — `~/.gemini/config/mcp_config.json` and `~/.gemini/config/skills/`, matching the current [MCP](https://antigravity.google/docs/mcp) and [Skills](https://antigravity.google/docs/skills) docs. The `antigravity-cli` global MCP config also lives in the shared `~/.gemini/config/mcp_config.json`, while the CLI keeps its own global skills tree at `~/.gemini/antigravity-cli/skills/`. Both targets also intentionally **share** the global rule file `~/.gemini/GEMINI.md` and the global hooks file `~/.gemini/config/hooks.json` — enabling both targets in `--global` mode writes those shared files once. For project-scope rules, **both `antigravity-ide` and `antigravity-cli`** emit the root rule as a plain cross-tool **`AGENTS.md`** at the project root (the Gemini-lineage discovery order is `AGENTS.md`, `CONTEXT.md`, `GEMINI.md`; the IDE has read `AGENTS.md` since v1.20.3) and non-root rules under `.agents/rules/` (the IDE adds trigger frontmatter to non-root rules; the CLI keeps them as plain markdown).
- **Kiro (`kiro`)** — Kiro ships as two products with diverging config formats: the **Kiro IDE** reads Markdown subagents (`.kiro/agents/*.md`) and `.kiro/hooks/*.kiro.hook` agent hooks, while the **Kiro CLI** reads JSON agent-config subagents (`.kiro/agents/*.json`) and agent hooks in `.kiro/agents/default.json`. A single target cannot emit both faithfully, so `kiro` is split into **`kiro-cli`** and **`kiro-ide`**. The legacy `kiro` target is kept as a **deprecated alias** (its current mixed output is unchanged for backward compatibility). Shared surfaces (steering rules with `inclusion`, `.kiro/settings/mcp.json`, `.kiro/prompts/` commands, `.kiro/skills/`, `.aiignore`, permissions) are identical between the two; they differ only in **subagents** (`.md` vs `.json`). Kiro IDE **hooks** (`.kiro/hooks/*.kiro.hook`) require multi-file output that the current single-file hooks pipeline does not yet emit, so `kiro-ide` does not support `hooks` (use `kiro-cli` for agent hooks).
