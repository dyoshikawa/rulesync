# Supported Tools and Features

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool                | --targets    | rules | ignore |   mcp    | commands | subagents | skills | hooks | permissions |
| ------------------- | ------------ | :---: | :----: | :------: | :------: | :-------: | :----: | :---: | :---------: |
| AGENTS.md           | agentsmd     |  ✅   |        |          |    🎮    |    🎮     |   🎮   |       |             |
| AgentsSkills        | agentsskills |       |        |          |          |           |   ✅   |       |             |
| Claude Code         | claudecode   | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Codex CLI           | codexcli     | ✅ 🌏 |        | ✅ 🌏 🔧 |    🌏    |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Gemini CLI          | geminicli    | ✅ 🌏 |   ✅   |  ✅ 🌏   |  ✅ 🌏   |    ✅     | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| GitHub Copilot      | copilot      | ✅ 🌏 |        |    ✅    |    ✅    |    ✅     |   ✅   |  ✅   |             |
| GitHub Copilot CLI  | copilotcli   | ✅ 🌏 |        |  ✅ 🌏   |          |   ✅ 🌏   |        | ✅ 🌏 |             |
| Goose               | goose        | ✅ 🌏 |   ✅   |          |          |           |        |       |             |
| Cursor              | cursor       |  ✅   |   ✅   |  ✅ 🌏   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Factory Droid       | factorydroid | ✅ 🌏 |        |  ✅ 🌏   |    🎮    |    🎮     |   🎮   | ✅ 🌏 |             |
| OpenCode            | opencode     | ✅ 🌏 |        | ✅ 🌏 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |    ✅ 🌏    |
| Cline               | cline        |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Kilo Code           | kilo         | ✅ 🌏 |   ✅   |    ✅    |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Roo Code            | roo          |  ✅   |   ✅   |    ✅    |    ✅    |    🎮     | ✅ 🌏  |       |             |
| Rovodev (Atlassian) | rovodev      | ✅ 🌏 |        |    🌏    |          |   ✅ 🌏   | ✅ 🌏  |       |             |
| Takt                | takt         | ✅ 🌏 |        |          |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |             |
| Qwen Code           | qwencode     |  ✅   |   ✅   |          |          |           |        |       |             |
| Kiro                | kiro         |  ✅   |   ✅   |    ✅    |    ✅    |    ✅     |   ✅   |       |     ✅      |
| Google Antigravity  | antigravity  |  ✅   |        |          |    ✅    |           | ✅ 🌏  |       |             |
| JetBrains Junie     | junie        |  ✅   |   ✅   |    ✅    |  ✅ 🌏   |    ✅     |   ✅   |       |             |
| AugmentCode         | augmentcode  |  ✅   |   ✅   |          |          |           |        |       |             |
| Windsurf            | windsurf     |  ✅   |   ✅   |          |          |           | ✅ 🌏  |       |             |
| Warp                | warp         |  ✅   |        |          |          |           |        |       |             |
| Replit              | replit       |  ✅   |        |          |          |           |   ✅   |       |             |
| Pi Coding Agent     | pi           | ✅ 🌏 |        |          |  ✅ 🌏   |           | ✅ 🌏  |       |             |
| Zed                 | zed          |       |   ✅   |          |          |           |        |       |             |

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)
