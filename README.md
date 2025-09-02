# rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rulesync)](https://www.npmjs.com/package/rulesync)
[![npm downloads](https://img.shields.io/npm/dt/rulesync)](https://www.npmjs.com/package/rulesync)

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. Features selective generation, comprehensive import/export capabilities, and supports 19+ AI development tools with rules, commands, MCP, ignore files, and subagents. Uses the recommended `.rulesync/rules/*.md` structure, with full backward compatibility for legacy `.rulesync/*.md` layouts.

## Installation

```bash
npm install -g rulesync
# or
pnpm add -g rulesync
# or  
yarn global add rulesync
# or
bun add -g rulesync

# And then
rulesync --version
rulesync --help
```

## Getting Started

```bash
# Create necessary directories and sample rule files
npx rulesync init
# Create a new configuration file
npx rulesync config --init
```

On the other hand, if you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
npx rulesync import --targets claudecode    # From CLAUDE.md
npx rulesync import --targets cursor        # From .cursorrules
npx rulesync import --targets copilot       # From .github/copilot-instructions.md
npx rulesync import --targets claudecode --features rules,mcp,commands,subagents

# And more tool supports

# Generate unified configurations with all features
npx rulesync generate --targets "*" --features "*"
```

## Supported Tools and Features

rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool                  | rules | ignore | mcp   | commands | subagents |
|------------------------|:-----:|:------:|:-----:|:--------:|:---------:|
| Claude Code            |  ✅   |      |  ✅    |    ✅     |    ✅      |
| Codex CLI              |  ✅   |   ✅   |      |         |          |
| Gemini CLI             |  ✅   |   ✅   |      |     ✅   |          |
| GitHub Copilot         |  ✅    |       |  ✅    |          |          |
| Cursor                 |  ✅   |   ✅  |   ✅   |          |          |
| OpenCode               |  ✅   |       |       |         |          |
| Cline                  |  ✅    |   ✅    |  ✅    |          |          |
| Roo Code               |  ✅   |   ✅   |  ✅    |   ✅     |          |
| Qwen Code              |  ✅   |   ✅   |       |         |          |
| Kiro IDE               |  ✅   |   ✅   |      |         |          |
| Amazon Q Developer CLI |  ✅   |       |  ✅   |         |          |
| JetBrains Junie        |  ✅   |   ✅   |      |         |          |
| AugmentCode            |  ✅   |   ✅   |       |         |          |
| Windsurf               |  ✅   |   ✅    |      |         |          |

## Why rulesync?

### 🔧 **Tool Flexibility**
Team members can freely choose their preferred AI coding tools. Whether it's GitHub Copilot, Cursor, Cline, or Claude Code, each developer can use the tool that maximizes their productivity.

### 📈 **Future-Proof Development**
AI development tools evolve rapidly with new tools emerging frequently. With rulesync, switching between tools doesn't require redefining your rules from scratch.

### 🎯 **Multi-Tool Workflow**
Enable hybrid development workflows combining multiple AI tools:
- **GitHub Copilot** for code completion and inline suggestions
- **Cursor** for intelligent refactoring and project-wide changes
- **Claude Code** for architecture design and complex problem solving
- **Cline** for autonomous debugging and file system operations
- **Amazon Q Developer CLI** for comprehensive chat-based development with built-in commands and MCP integration
- **OpenCode** for secure terminal-based development with granular permission controls
- **Windsurf** for comprehensive AI-assisted editing with Cascade AI
- **Gemini CLI** for Google AI integration and custom workflows

### 🔓 **No Lock-in**
Avoid lock-in completely. If you decide to stop using rulesync, you can continue using the generated rule files as-is.

### 🎯 **Consistency Across Tools**
Apply consistent rules across all AI tools, improving code quality and development experience for the entire team.

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
npx rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
npx rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents

# Generate all features for all tools (new preferred syntax)
npx rulesync generate --targets "*" --features "*"

# Generate specific features for specific tools
npx rulesync generate --targets copilot,cursor,cline --features rules,mcp
npx rulesync generate --targets claudecode --features rules,subagents

# Generate only rules (no MCP, ignore files, commands, or subagents)
npx rulesync generate --targets "*" --features rules

# Add generated files to .gitignore
npx rulesync gitignore
```

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

For development setup and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).
