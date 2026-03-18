# Supported Tools and Features

Rulesync supports both **generation** and **import** for most major AI coding tools (see Codex CLI permissions note below):

| Tool               | --targets    | rules | ignore |   mcp    | commands | subagents | skills | hooks | permissions |
| ------------------ | ------------ | :---: | :----: | :------: | :------: | :-------: | :----: | :---: | :---------: |
| AGENTS.md          | agentsmd     |  ✅   |        |          |    🎮    |    🎮     |   🎮   |       |             |
| AgentsSkills       | agentsskills |       |        |          |          |           |   ✅   |       |             |
| Claude Code        | claudecode   | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |
| Codex CLI          | codexcli     | ✅ 🌏 |        | ✅ 🌏 🔧 |    🌏    |    ✅     | ✅ 🌏  |       |     ✅      |
| Gemini CLI         | geminicli    | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |    🎮     | ✅ 🌏  | ✅ 🌏 |             |
| GitHub Copilot     | copilot      | ✅ 🌏 |        |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |             |
| Goose              | goose        | ✅ 🌏 |   ✅   |          |          |           |        |       |             |
| Cursor             | cursor       |  ✅   |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |  ✅   |             |
| Factory Droid      | factorydroid | ✅ 🌏 |        |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |             |
| OpenCode           | opencode     | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |     ✅      |
| Cline              | cline        |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Kilo Code          | kilo         | ✅ 🌏 |   ✅   |    ✅    |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Roo Code           | roo          |  ✅   |   ✅   |    ✅    |    ✅    |    🎮     | ✅ 🌏  |       |             |
| Qwen Code          | qwencode     |  ✅   |   ✅   |          |          |           |        |       |             |
| Kiro               | kiro         |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |       |             |
| Google Antigravity | antigravity  |  ✅   |        |          |    ✅    |           | ✅ 🌏  |       |             |
| JetBrains Junie    | junie        |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |    ✅     |   ✅   |       |             |
| AugmentCode        | augmentcode  |  ✅   |   ✅   |          |          |           |        |       |             |
| Windsurf           | windsurf     |  ✅   |   ✅   |          |          |           |        |       |             |
| Warp               | warp         |  ✅   |        |          |          |           |        |       |             |
| Replit             | replit       |  ✅   |        |          |          |           |   ✅   |       |             |
| Zed                | zed          |       |   ✅   |          |          |           |        |       |             |

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)

Notes:

- Codex CLI permissions are generate-only (import is not supported).
