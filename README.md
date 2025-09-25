# Rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rulesync)](https://www.npmjs.com/package/rulesync)
[![npm downloads](https://img.shields.io/npm/dt/rulesync)](https://www.npmjs.com/package/rulesync)

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. Features selective generation, comprehensive import/export capabilities, and supports major AI development tools with rules, commands, MCP, ignore files, and subagents. Uses the recommended `.rulesync/rules/*.md` structure, with full backward compatibility for legacy `.rulesync/*.md` layouts.

> [!NOTE]
> If you are interested in Rulesync latest news, please follow the maintainer's X(Twitter) account:
> [@dyoshikawa1993](https://x.com/dyoshikawa1993)

## Installation

```bash
npm install -g rulesync
# or
pnpm add -g rulesync
# or
yarn global add rulesync
# or
bun add -g rulesync
# or
brew install rulesync

# And then
rulesync --version
rulesync --help
```

## Getting Started

```bash
# Create necessary directories and sample rule files
npx rulesync init
# Create a new configuration file
npx rulesync config init
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

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool                  | rules | ignore | mcp   | commands | subagents |
|------------------------|:-----:|:------:|:-----:|:--------:|:---------:|
| AGENTS.md            |  ✅   |      |       |          |           |
| Claude Code            |  ✅ 🌏   |  ✅   |  ✅    |    ✅     |    ✅      |
| Codex CLI              |  ✅ 🌏   |   ✅   |      |    🎮     |    🎮      |
| Gemini CLI             |  ✅   |   ✅   |      |     ✅   |      🎮     |
| GitHub Copilot         |  ✅    |       |  ✅    |    🎮      |    🎮      |
| Cursor                 |  ✅   |   ✅  |   ✅   |     ✅    |     🎮     |
| OpenCode               |  ✅   |       |       |         |          |
| Cline                  |  ✅    |   ✅    |  ✅    |          |          |
| Roo Code               |  ✅   |   ✅   |  ✅    |   ✅     |     🎮     |
| Qwen Code              |  ✅   |   ✅   |       |         |          |
| Kiro IDE               |  ✅   |   ✅   |      |         |          |
| Amazon Q Developer CLI |  ✅   |       |  ✅   |         |          |
| JetBrains Junie        |  ✅   |   ✅   |      |         |          |
| AugmentCode            |  ✅   |   ✅   |       |         |          |
| Windsurf               |  ✅   |   ✅    |      |         |          |
| Warp               |  ✅   |        |      |         |          |

🌏: Supports global(means user scope) mode (Experimental Feature, `~/.rulesync/`)
🎮: Simulated Commands/Subagents (Experimental Feature)

## Why Rulesync?

### 🔧 **Tool Flexibility**
Team members can freely choose their preferred AI coding tools. Whether it's GitHub Copilot, Cursor, Cline, or Claude Code, each developer can use the tool that maximizes their productivity.

### 📈 **Future-Proof Development**
AI development tools evolve rapidly with new tools emerging frequently. With Rulesync, switching between tools doesn't require redefining your rules from scratch.

### 🎯 **Multi-Tool Workflow**
Enable hybrid development workflows combining multiple AI tools.

### 🔓 **No Lock-in**
Avoid lock-in completely. If you decide to stop using Rulesync, you can continue using the generated rule files as-is.

### 🎯 **Consistency Across Tools**
Apply consistent rules across all AI tools, improving code quality and development experience for the entire team.

### 🌏 **Global Mode**
You can use global(also, called as user scope) settings via Rulesync by creating the `~/.rulesync/` directory and files in it.

### 🎮 **Simulated Commands and Subagents**
Simulated commands and subagents are experimental features that allow you to generate simulated commands and subagents for copilot, cursor and codexcli. This is useful for shortening your prompts.

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

# Generate simulated commands and subagents with experimental features
npx rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --experimental-simulate-commands --experimental-simulate-subagents

# Add generated files to .gitignore
npx rulesync gitignore
```

## Configuration

You can configure Rulesync by creating a `rulesync.jsonc` file in the root of your project.

Example:

```jsonc
// rulesync.jsonc
{
  // List of tools to generate configurations for. You can specify "*" to generate all tools.
  "targets": ["cursor", "claudecode", "geminicli", "opencode", "codexcli"],

  // Features to generate. You can specify "*" to generate all features.
  "features": ["rules", "ignore", "mcp", "commands", "subagents"],
  
  // Base directories for generation.
  // Basically, you can specify a `["."]` only.
  // However, for example, if your project is a monorepo and you have to launch the AI agent at each package directory, you can specify multiple base directories.
  "baseDirs": ["."],
  
  // Delete existing files before generating
  "delete": true,

  // Verbose output
  "verbose": false,

  // Experimental features
  "experimentalGlobal": false, // Unless it is located in the `~/.rulesync/`, it is ignored.
  "experimentalSimulateCommands": false,
  "experimentalSimulateSubagents": false
}
```

## Each File Format

### `rulesync/rules/*.md`

Example:

```md
---
root: true # true that is less than or equal to one file for overview such as `AGENTS.md`, false for details such as `.agents/memories/*.md`
targets: ["*"] # * = all, or specific tools
description: "Rulesync project overview and development guidelines for unified AI rules management CLI tool"
globs: ["**/*"] # file patterns to match (e.g., ["*.md", "*.txt"])
agentsmd: # agentsmd and codexcli specific rules
  # Support for using nested AGENTS.md files for subprojects in a large monorepo.
  # This option is available only if root is false.
  # If subprojectPath is provided, the file is located in `${subprojectPath}/AGENTS.md`.
  # If subprojectPath is not provided and root is false, the file is located in `.agents/memories/*.md`.
  subprojectPath: "path/to/subproject"
cursor: # cursor specific rules
  alwaysApply: true
  description: "Rulesync project overview and development guidelines for unified AI rules management CLI tool"
  globs: ["*"]
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

...
```

### `rulesync/commands/*.md`

Example:

```md
---
description: 'Review a pull request' # command description
targets: ["*"] # * = all, or specific tools
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

...
```

### `rulesync/subagents/*.md`

Example:

```md
---
name: planner # subagent name
targets: ["*"] # * = all, or specific tools
description: >- # subagent description
  This is the general-purpose planner. The user asks the agent to plan to
  suggest a specification, implement a new feature, refactor the codebase, or
  fix a bug. This agent can be called by the user explicitly only.
claudecode: # for claudecode-specific rules
  model: opus # opus, sonnet, haiku or inherit
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
```

### `.rulesync/.mcp.json`

Example:

```json
{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--enable-web-dashboard",
        "false",
        "--project",
        "."
      ],
      "env": {}
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
  }
}
```

### `.rulesyncignore`

Example:

```ignore
tmp/
credentials/
```

## Global Mode(Experimental Feature)

You can use global(also, called as user scope) settings via Rulesync by creating the `~/.rulesync/` directory and files in it.

Currently, only supports rules generation. Import for global settings is still not supported.

Usage:

1. Initialize files for global settings.
    ```bash
    npx rulesync init --experimental-global
    npx rulesync config init --experimental-global
    ```
2. Generate rules for global settings.
    ```bash
    npx rulesync generate --targets "*" --features "*" --experimental-global
    ```
3. Edit `~/.rulesync/rules/overview.md` to your preferences.
    ```md
    ---
    root: true
    ---
    # The Project Overview
    ...
    ```
4. Generate rules for global settings.
    ```bash
    # Run in the `~/.rulesync/` directory.
    npx rulesync generate
    ```

> [!WARNING]
> * About `rulesync.jsonc` location, when existing project scope mode, it located in the project root directory, out of the `~/.rulesync/`. However when global scope mode, it located in `~/.rulesync/`. It may confuse you, attention.
> * `~/.rulesync/rulesync.jsonc` only supports `global`, `features`, `delete` and `verbose`. `Features` can be set `"rules"` only. Other parameters are ignored.
> * `~/.rulesync/rules/*.md` only supports single file has `root: true`, and frontmatter parameters without `root` are ignored.

## Simulate Commands and Subagents(Experimental Feature)

Simulated commands and subagents are experimental features that allow you to generate simulated commands and subagents for copilot, cursor, codexcli and etc. This is useful for shortening your prompts.

1. Prepare `.rulesync/commands/*.md` and `.rulesync/subagents/*.md` for your purposes.
2. Generate simulated commands and subagents for specific tools that are included in copilot, cursor, codexcli and etc.
    ```bash
    npx rulesync generate \
      --targets copilot,cursor,codexcli \
      --features commands,subagents \
      --experimental-simulate-commands \
      --experimental-simulate-subagents
    ```
3. Use simulated commands and subagents in your prompts.
    - Prompt examples:
      ```txt
      # Execute simulated commands. By the way, `s/` stands for `simulate/`.
      s/your-command

      # Execute simulated subagents
      Call your-subagent to achieve something.
      ```

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

For development setup and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).
