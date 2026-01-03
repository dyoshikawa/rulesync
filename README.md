<p align="center">
  <img src="images/logo.jpg" alt="Rulesync Logo" width="600">
</p>

# Rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rulesync)](https://www.npmjs.com/package/rulesync)
[![npm downloads](https://img.shields.io/npm/dt/rulesync)](https://www.npmjs.com/package/rulesync)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dyoshikawa/rulesync)
[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)
[![Mentioned in Awesome Gemini CLI](https://awesome.re/mentioned-badge.svg)](https://github.com/Piebald-AI/awesome-gemini-cli)
<a href="https://flatt.tech/oss/gmo/trampoline" target="_blank"><img src="https://flatt.tech/assets/images/badges/gmo-oss.svg" height="24px"/></a>

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. Features selective generation, comprehensive import/export capabilities, and supports major AI development tools with rules, commands, MCP, ignore files, subagents and skills.

> [!NOTE]
> If you are interested in Rulesync latest news, please follow the maintainer's X(Twitter) account:
> [@dyoshikawa1993](https://x.com/dyoshikawa1993)

## Installation

### Package Managers

```bash
npm install -g rulesync
# or
brew install rulesync

# And then
rulesync --version
rulesync --help
```

### Single Binary (Experimental)

Download pre-built binaries from the [latest release](https://github.com/dyoshikawa/rulesync/releases/latest).

<details>
<summary>Commands to install a binary for your platform</summary>

#### Linux (x64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-x64 -o rulesync
chmod +x rulesync
# Place the binary wherever set PATH
sudo mv rulesync /usr/local/bin/
```

#### Linux (ARM64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-arm64 -o rulesync
chmod +x rulesync
# Place the binary wherever set PATH
sudo mv rulesync /usr/local/bin/
```

#### macOS (Apple Silicon)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-darwin-arm64 -o rulesync
chmod +x rulesync
# Place the binary wherever set PATH
sudo mv rulesync /usr/local/bin/
```

#### Windows (x64)

```powershell
# PowerShell
Invoke-WebRequest -Uri "https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe" -OutFile "rulesync.exe"
# Add to PATH or place in a directory already in PATH
Move-Item rulesync.exe C:\Windows\System32\
```

Or using curl (if available):

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe -o rulesync.exe
# Place the binary wherever set PATH
```

#### Verify checksums

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/SHA256SUMS -o SHA256SUMS

# Linux/macOS
sha256sum -c SHA256SUMS

# Windows (PowerShell)
# Download SHA256SUMS file first, then verify:
Get-FileHash rulesync.exe -Algorithm SHA256 | ForEach-Object {
  $actual = $_.Hash.ToLower()
  $expected = (Get-Content SHA256SUMS | Select-String "rulesync-windows-x64.exe").ToString().Split()[0]
  if ($actual -eq $expected) { "✓ Checksum verified" } else { "✗ Checksum mismatch" }
}
```
</details>

## Getting Started

```bash
# Create necessary directories, sample rule files, and configuration file
npx rulesync init
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

| Tool                  | rules | ignore | mcp   | commands | subagents | skills |
|------------------------|:-----:|:------:|:-----:|:--------:|:---------:|:------:|
| AGENTS.md            |  ✅   |      |       |     🎮     |      🎮     |    🎮   |
| Claude Code            |  ✅ 🌏   |  ✅   |  ✅ 🌏 📦   |    ✅ 🌏     |    ✅ 🌏     |  ✅ 🌏   |
| Codex CLI              |  ✅ 🌏   |      |   🌏   |     🌏    |    🎮      |    🌏   |
| Gemini CLI             |  ✅ 🌏  |   ✅   |  ✅ 🌏  |     ✅ 🌏  |      🎮     |    🎮   |
| GitHub Copilot         |  ✅    |       |  ✅    |     ✅     |    ✅      |    ✅   |
| Cursor                 |  ✅   |   ✅  |   ✅   |     ✅ 🌏  |     🎮     |    ✅   |
| OpenCode               |  ✅   |       |   ✅   |    ✅ 🌏    |   ✅ 🌏    |   ✅ 🌏  |
| Cline                  |  ✅    |   ✅    |  ✅    |     ✅ 🌏  |          |        |
| Kilo Code              |  ✅ 🌏   |        |       |    ✅ 🌏     |          |        |
| Roo Code               |  ✅   |   ✅   |  ✅    |   ✅     |     🎮     |   ✅ 🌏  |
| Qwen Code              |  ✅   |   ✅   |       |         |          |        |
| Kiro IDE               |  ✅   |   ✅   |      |         |          |        |
| Google Antigravity     |  ✅   |       |       |    ✅    |          |        |
| JetBrains Junie        |  ✅   |   ✅   |  ✅   |         |          |        |
| AugmentCode            |  ✅   |   ✅   |       |         |          |        |
| Windsurf               |  ✅   |   ✅    |      |         |          |        |
| Warp               |  ✅   |        |      |         |          |        |

* ✅: Supports project mode
* 🌏: Supports global mode
* 🎮: Supports simulated commands/subagents/skills (Project mode only)
* 📦: Supports modular MCP (Experimental)

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
You can use global mode via Rulesync by enabling `--global` option.

### 🎮 **Simulate Commands and Subagents**
Simulated commands and subagents allow you to generate simulated commands and subagents for cursor and codexcli. This is useful for shortening your prompts.

## Case Studies

Rulesync is trusted by leading companies and recognized by the industry:

- **Anthropic Official Customer Story**: [Classmethod Inc. - Improving AI coding tool consistency with Rulesync](https://claude.com/customers/classmethod)
- **Asoview Inc.**: [Adopting Rulesync for unified AI development rules](https://tech.asoview.co.jp/entry/2025/12/06/100000)
- **KAKEHASHI Tech Blog**: [Building multilingual systems for the LLM era with a monorepo and a "living specification"](https://kakehashi-dev.hatenablog.com/entry/2025/12/08/110000)

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
npx rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
npx rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents,skills

# Generate all features for all tools (new preferred syntax)
npx rulesync generate --targets "*" --features "*"

# Generate specific features for specific tools
npx rulesync generate --targets copilot,cursor,cline --features rules,mcp
npx rulesync generate --targets claudecode --features rules,subagents

# Generate only rules (no MCP, ignore files, commands, or subagents)
npx rulesync generate --targets "*" --features rules

# Generate simulated commands and subagents
npx rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --simulate-commands --simulate-subagents

# Add generated files to .gitignore
npx rulesync gitignore
```

## Configuration

You can configure Rulesync by creating a `rulesync.jsonc` file in the root of your project.

### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `rulesync.jsonc`:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  "targets": ["claudecode"],
  "features": ["rules"]
}
```

### Configuration Options

Example:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",

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

  // Advanced options
  "global": false,  // Generate for global(user scope) configuration files
  "simulateCommands": false,  // Generate simulated commands
  "simulateSubagents": false,  // Generate simulated subagents
  "simulateSkills": false,  // Generate simulated skills
  "modularMcp": false  // Enable modular-mcp for context compression (experimental, Claude Code only)
}
```

### Target Order and File Conflicts

When multiple targets write to the same output file, **the last target in the array wins**. This is the "last-wins" behavior.

For example, both `agentsmd` and `opencode` generate `AGENTS.md`:

```jsonc
{
  // opencode wins because it comes last
  "targets": ["agentsmd", "opencode"],
  "features": ["rules"]
}
```

In this case:
1. `agentsmd` generates `AGENTS.md` first
2. `opencode` generates `AGENTS.md` second, overwriting the previous file

If you want `agentsmd`'s output instead, reverse the order:

```jsonc
{
  // agentsmd wins because it comes last
  "targets": ["opencode", "agentsmd"],
  "features": ["rules"]
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
agentsmd: # agentsmd and codexcli specific parameters
  # Support for using nested AGENTS.md files for subprojects in a large monorepo.
  # This option is available only if root is false.
  # If subprojectPath is provided, the file is located in `${subprojectPath}/AGENTS.md`.
  # If subprojectPath is not provided and root is false, the file is located in `.agents/memories/*.md`.
  subprojectPath: "path/to/subproject"
cursor: # cursor specific parameters
  alwaysApply: true
  description: "Rulesync project overview and development guidelines for unified AI rules management CLI tool"
  globs: ["*"]
antigravity: # antigravity specific parameters
  trigger: "always_on" # always_on, glob, manual, or model_decision
  globs: ["**/*"] # (optional) file patterns to match when trigger is "glob"
  description: "When to apply this rule" # (optional) used with "model_decision" trigger
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

...
```

### `.kilocode/rules/*.md` (Kilo Code)

Kilo Code loads project rules from `.kilocode/rules/` and global rules from `~/.kilocode/rules/`. The tool also supports mode-specific directories like `.kilocode/rules-{mode}` and legacy single-file fallbacks such as `.kilocoderules-{mode}` (or `.kilocoderules`, `.clinerules`, and `.roorules`), but Rulesync generates the directory-based layout by default.

### `.kilocode/workflows/*.md` (Kilo Code Workflows)

Kilo Code workflows map to Rulesync commands. Place Markdown workflow files in `.kilocode/workflows/` for project scope or `~/.kilocode/workflows/` for global scope. Workflows can be invoked in Kilo Code via slash commands like `/submit-pr.md`.

### `rulesync/commands/*.md`

Example:

```md
---
description: 'Review a pull request' # command description
targets: ["*"] # * = all, or specific tools
copilot: # copilot specific parameters (optional)
  description: "Review a pull request"
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
claudecode: # for claudecode-specific parameters
  model: inherit # opus, sonnet, haiku or inherit
copilot: # for GitHub Copilot specific parameters
  tools:
    - web/fetch # agent/runSubagent is always included automatically
opencode: # for OpenCode-specific parameters
  mode: subagent # must be set so OpenCode treats the agent as a subagent
  model: anthropic/claude-sonnet-4-20250514
  temperature: 0.1
  tools:
    write: false
    edit: false
    bash: false
  permission:
    bash:
      "git diff": allow
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
```

### `.rulesync/skills/*/SKILL.md`

Example:

```md
---
name: example-skill # skill name
description: >- # skill description
  A sample skill that demonstrates the skill format
targets: ["*"] # * = all, or specific tools
claudecode: # for claudecode-specific parameters
  allowed-tools:
    - "Bash"
    - "Read"
    - "Write"
    - "Grep"
---

This is the skill body content.

You can provide instructions, context, or any information that helps the AI agent understand and execute this skill effectively.

The skill can include:
- Step-by-step instructions
- Code examples
- Best practices
- Any relevant context

Skills are directory-based and can include additional files alongside SKILL.md.
```

### `.rulesync/mcp.json`

Example:

```json
{
  "mcpServers": {
    "serena": {
      "description": "Code analysis and semantic search MCP server",
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
      "description": "Library documentation search server",
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

### `.rulesync/.aiignore` or `.rulesyncignore`

Rulesync supports a single ignore list that can live in either location below:

- `.rulesync/.aiignore` (recommended)
- `.rulesyncignore` (project root)

Rules and behavior:

- You may use either location.
- When both exist, Rulesync prefers `.rulesync/.aiignore` (recommended) over `.rulesyncignore` (legacy) when reading.
- If neither file exists yet, Rulesync defaults to creating `.rulesync/.aiignore`.

Notes:
- Running `rulesync init` will create `.rulesync/.aiignore` if no ignore file is present.

Example:

```ignore
tmp/
credentials/
```

## Global Mode

You can use global mode via Rulesync by enabling `--global` option. It can also be called as user scope mode.

Currently, supports rules and commands generation for Claude Code. Import for global files is supported for rules and commands.

1. Create an any name directory. For example, if you prefer `~/.aiglobal`, run the following command.
    ```bash
    mkdir -p ~/.aiglobal
    ```
2. Initialize files for global files in the directory.
    ```bash
    cd ~/.aiglobal
    npx rulesync init
    ``` 
3. Edit `~/.aiglobal/rulesync.jsonc` to enable global mode.
    ```jsonc
    {
      "global": true
    }
    ```
4. Edit `~/.aiglobal/.rulesync/rules/overview.md` to your preferences.
    ```md
    ---
    root: true
    ---
    # The Project Overview
    ...
    ```
5. Generate rules for global settings.
    ```bash
    # Run in the `~/.aiglobal` directory
    npx rulesync generate
    ```

> [!NOTE]
> Currently, when in the directory enabled global mode:
> * `rulesync.jsonc` only supports `global`, `features`, `delete` and `verbose`. `Features` can be set `"rules"` and `"commands"`. Other parameters are ignored.
> * `rules/*.md` only supports single file has `root: true`, and frontmatter parameters without `root` are ignored.
> * Only Claude Code is supported for global mode commands.

## Simulate Commands, Subagents and Skills

Simulated commands, subagents and skills allow you to generate simulated features for cursor, codexcli and etc. This is useful for shortening your prompts.

1. Prepare `.rulesync/commands/*.md`, `.rulesync/subagents/*.md` and `.rulesync/skills/*/SKILL.md` for your purposes.
2. Generate simulated commands, subagents and skills for specific tools that are included in cursor, codexcli and etc.
    ```bash
    npx rulesync generate \
      --targets copilot,cursor,codexcli \
      --features commands,subagents,skills \
      --simulate-commands \
      --simulate-subagents \
      --simulate-skills
    ```
3. Use simulated commands, subagents and skills in your prompts.
    - Prompt examples:
      ```txt
      # Execute simulated commands. By the way, `s/` stands for `simulate/`.
      s/your-command

      # Execute simulated subagents
      Call your-subagent to achieve something.

      # Use simulated skills
      Use the skill your-skill to achieve something.
      ```

## Modular MCP (Experimental)

Rulesync supports compressing tokens consumed by MCP servers [d-kimuson/modular-mcp](https://github.com/d-kimuson/modular-mcp) for context saving. When enabled with `--modular-mcp`, it additionally generates `modular-mcp.json`.

```bash
# Enable modular-mcp via CLI
npx rulesync generate --targets claudecode --features mcp --modular-mcp

# Or via configuration file
{
  "modularMcp": true
}
```

When enabling modular-mcp, each MCP server must have a `description` field. Example:

```diff
// .rulesync/mcp.json
{
  "mcpServers": {
    "context7": {
+     "description": "Up-to-date documentation and code examples for libraries",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
}
```

You can also configure `exposed` to exclude specific MCP servers from modular-mcp. It is optional and default to `false`. If you specify `exposed: true`, the MCP server is always loaded in the initial context.

```diff
// .rulesync/mcp.json
{
  "mcpServers": {
    "context7": {
+     "exposed": true,
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
}
```

To demonstrate the effect of modular-mcp, please see the following example:

<details>
<summary>Example of effect</summary>

Please see examples using Claude Code.

When using following mcp servers:

```json
// .rulesync/mcp.json

{
  "mcpServers": {
    "serena": {
      "description": "Semantic coding tools for intelligent codebase exploration and manipulation",
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
      "description": "Up-to-date documentation and code examples for libraries",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    },
    "fetch": {
      "description": "This server enables LLMs to retrieve and process content from web pages, converting HTML to markdown for easier consumption.",
      "type": "stdio",
      "command": "uvx",
      "args": [
        "mcp-server-fetch"
      ],
      "env": {}
    }
  }
}
```

Once run `rulesync generate --targets claudecode --features mcp`, `/context` result on Claude Code is as follows:

```
      Context Usage
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   claude-sonnet-4-5-20250929 · 82k/200k tokens (41%)
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛀ 
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System prompt: 2.5k tokens (1.3%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System tools: 13.9k tokens (6.9%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ MCP tools: 15.7k tokens (7.9%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Memory files: 5.2k tokens (2.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 8 tokens (0.0%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝   ⛶ Free space: 118k (58.8%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝   ⛝ Autocompact buffer: 45.0k tokens (22.5%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝
```

On the other hand, once run `rulesync generate --targets claudecode --features mcp --modular-mcp`, `/context` result on Claude Code is as follows:

``` 
      Context Usage
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛁   claude-sonnet-4-5-20250929 · 68k/200k tokens (34%)
     ⛁ ⛀ ⛀ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ 
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System prompt: 2.5k tokens (1.3%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System tools: 13.5k tokens (6.8%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ MCP tools: 1.3k tokens (0.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Memory files: 5.2k tokens (2.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 8 tokens (0.0%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝   ⛶ Free space: 132k (66.2%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝   ⛝ Autocompact buffer: 45.0k tokens (22.5%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝
```

Focus on the difference of MCP tools usage.

| | Context Usage|
|---|---|
|Disabled Modular MCP| 15.7k tokens (7.9%) |
|Enabled Modular MCP| 1.3k tokens (0.6%) |

So, in this case, approximately 92% reduction in MCP tools consumption!
</details>

## Rulesync MCP Server

Rulesync provides an MCP (Model Context Protocol) server that enables AI agents to manage your Rulesync files. This allows AI agents to discover, read, create, update, and delete files dynamically.

> [!NOTE]
> The MCP server exposes the only one tool to minimize your agent's token usage. Approximately less than 1k tokens for the tool definition.

### Available Tools

The Rulesync MCP server provides the following tools:

<details>
<summary>Rules Management</summary>

- `list` - List all rule files
- `get` - Get a specific rule file
- `put` - Create or update a rule file
- `delete` - Delete a rule file

</details>

<details>
<summary>Commands Management</summary>

- `list` - List all command files
- `get` - Get a specific command file
- `put` - Create or update a command file
- `delete` - Delete a command file

</details>

<details>
<summary>Subagents Management</summary>

- `list` - List all subagent files
- `get` - Get a specific subagent file
- `put` - Create or update a subagent file
- `delete` - Delete a subagent file

</details>

<details>
<summary>Skills Management</summary>

- `list` - List all skill directories
- `get` - Get a specific skill (SKILL.md and other files)
- `put` - Create or update a skill directory
- `delete` - Delete a skill directory

</details>

<details>
<summary>Ignore Files Management</summary>

- `getIgnoreFile` - Get the ignore file
- `putIgnoreFile` - Create or update the ignore file
- `deleteIgnoreFile` - Delete the ignore file

</details>

<details>
<summary>MCP Configuration Management</summary>

- `getMcpFile` - Get the MCP configuration file
- `putMcpFile` - Create or update the MCP configuration file
- `deleteMcpFile` - Delete the MCP configuration file

</details>

### Usage

#### Starting the MCP Server

```bash
rulesync mcp
```

This starts an MCP server using stdio transport that AI agents can communicate with.

#### Configuration

Add the Rulesync MCP server to your `.rulesync/mcp.json`:

```json
{
  "mcpServers": {
    "rulesync-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rulesync", "mcp"],
      "env": {}
    }
  }
}
```

## FAQ

### Q. The generated `.mcp.json` doesn't work properly in Claude Code.

You can try adding the following to `.claude/settings.json` or `.claude/settings.local.json`:

```diff
{
+ "enableAllProjectMcpServers": true
}
```

According to [the documentation](https://code.claude.com/docs/en/settings), this means:

> Automatically approve all MCP servers defined in project .mcp.json files

## License

MIT License
