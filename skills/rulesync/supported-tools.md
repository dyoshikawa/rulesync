# Supported Tools and Features

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool                   | --targets       | rules | ignore |   mcp    | commands | subagents | skills | hooks | permissions |
| ---------------------- | --------------- | :---: | :----: | :------: | :------: | :-------: | :----: | :---: | :---------: |
| AGENTS.md              | agentsmd        |  ✅   |        |          |    🎮    |    🎮     |   🎮   |       |             |
| AgentsSkills           | agentsskills    |       |        |          |          |           |   ✅   |       |             |
| Claude Code            | claudecode      | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Codex CLI              | codexcli        | ✅ 🌏 |        | ✅ 🌏 🔧 |    🌏    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Gemini CLI ⚠️          | geminicli       | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |    ✅     | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| GitHub Copilot         | copilot         | ✅ 🌏 |        |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |             |
| GitHub Copilot CLI     | copilotcli      | ✅ 🌏 |        |  ✅ 🌏   |          |   ✅ 🌏   |        | ✅ 🌏 |             |
| Goose                  | goose           | ✅ 🌏 |   ✅   |          |          |           |        |       |             |
| Cursor                 | cursor          |  ✅   |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Factory Droid          | factorydroid    | ✅ 🌏 |        |  ✅ 🌏   |    🎮    |    🎮     |   🎮   | ✅ 🌏 |             |
| OpenCode               | opencode        | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Cline                  | cline           |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |           | ✅ 🌏  |       |     ✅      |
| Kilo Code              | kilo            | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |           | ✅ 🌏  |       |    ✅ 🌏    |
| Roo Code               | roo             |  ✅   |   ✅   |    ✅    |    ✅    |    🎮     | ✅ 🌏  |       |             |
| Rovodev (Atlassian)    | rovodev         | ✅ 🌏 |        |    🌏    |          |   ✅ 🌏   | ✅ 🌏  |       |             |
| Takt                   | takt            | ✅ 🌏 |        |          |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |             |
| Qwen Code              | qwencode        |  ✅   |   ✅   |          |          |           |        |       |    ✅ 🌏    |
| Kiro                   | kiro            |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Google Antigravity IDE | antigravity-ide | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |           | ✅ 🌏  | ✅ 🌏 |             |
| Google Antigravity CLI | antigravity-cli | ✅ 🌏 |        | ✅ 🌏 🔧 |          |           | ✅ 🌏  | ✅ 🌏 |     🌏      |
| Google Antigravity ⚠️  | antigravity     |  ✅   |        |          |    ✅    |           | ✅ 🌏  |       |             |
| JetBrains Junie        | junie           |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |    ✅     |   ✅   |       |             |
| AugmentCode            | augmentcode     |  ✅   |   ✅   |          |          |           |        |       |    ✅ 🌏    |
| Windsurf               | windsurf        |  ✅   |   ✅   |          |          |           | ✅ 🌏  |       |             |
| Warp                   | warp            |  ✅   |        |          |          |           |        |       |             |
| Replit                 | replit          |  ✅   |        |          |          |           |   ✅   |       |             |
| Pi Coding Agent        | pi              | ✅ 🌏 |        |          |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Zed                    | zed             | ✅ 🌏 |   ✅   |  ✅ 🌏   |          |           | ✅ 🌏  |       |             |

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)
- ⚠️: Deprecated — still supported, but see the note below

## Deprecation notes

- **Gemini CLI (`geminicli`)** — Google is retiring Gemini CLI on **June 18, 2026**, when it stops serving requests for Google AI Pro/Ultra and free Gemini Code Assist for individuals (Enterprise plans are unaffected). The successor is the **Antigravity CLI (`antigravity-cli`)**. `geminicli` is **not** removed from rulesync — Enterprise access continues and existing `GEMINI.md`/`.gemini/` repositories still rely on it — but new projects should prefer `antigravity-cli`. See the [Gemini CLI → Antigravity CLI migration guide](../guide/geminicli-to-antigravity-cli.md).
- **Google Antigravity (`antigravity`)** — Antigravity 2.0 splits into two products with separate global config trees: the desktop **`antigravity-ide`** and the **`antigravity-cli`** (`agy`). The legacy `antigravity` target is now a **deprecated alias for `antigravity-ide`** that keeps its original `.agent/` (singular) paths for backward compatibility. Migrate to `antigravity-ide` (desktop IDE) or `antigravity-cli` (CLI). The two split targets keep separate global trees for skills and MCP (`~/.gemini/antigravity/` vs `~/.gemini/antigravity-cli/`), but intentionally **share** the global rule file `~/.gemini/GEMINI.md` and the global hooks file `~/.gemini/config/hooks.json` — enabling both targets in `--global` mode writes those two shared files once.
