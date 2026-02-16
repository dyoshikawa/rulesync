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

Download pre-built binaries from the [latest release](https://github.com/dyoshikawa/rulesync/releases/latest). These binaries are built using [Bun's single-file executable bundler](https://bun.sh/docs/bundler/executables).

**Quick Install (Linux/macOS - No sudo required):**

```bash
curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
```

Options:

- Install specific version: `curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash -s -- v6.4.0`
- Custom directory: `RULESYNC_HOME=~/.local curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash`

<details>
<summary>Manual installation (requires sudo)</summary>

#### Linux (x64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-x64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### Linux (ARM64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-arm64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### macOS (Apple Silicon)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-darwin-arm64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### macOS (Intel)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-darwin-x64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### Windows (x64)

```powershell
Invoke-WebRequest -Uri "https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe" -OutFile "rulesync.exe"; `
  Move-Item rulesync.exe C:\Windows\System32\
```

Or using curl (if available):

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe -o rulesync.exe && \
  mv rulesync.exe /path/to/your/bin/
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
# Install rulesync globally
npm install -g rulesync

# Create necessary directories, sample rule files, and configuration file
rulesync init

# Install official skills (recommended)
rulesync fetch dyoshikawa/rulesync --features skills

# Or add skill sources to rulesync.jsonc and run 'rulesync install' (see "Declarative Skill Sources")
```

On the other hand, if you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
rulesync import --targets claudecode    # From CLAUDE.md
rulesync import --targets cursor        # From .cursorrules
rulesync import --targets copilot       # From .github/copilot-instructions.md
rulesync import --targets claudecode --features rules,mcp,commands,subagents

# And more tool supports

# Generate unified configurations with all features
rulesync generate --targets "*" --features "*"
```

## Supported Tools and Features

Rulesync supports both **generation** and **import** for All of the major AI coding tools:

| Tool               | --targets    | rules | ignore |  mcp  | commands | subagents | skills | hooks |
| ------------------ | ------------ | :---: | :----: | :---: | :------: | :-------: | :----: | :---: |
| AGENTS.md          | agentsmd     |  ✅   |        |       |    🎮    |    🎮     |   🎮   |       |
| AgentsSkills       | agentsskills |       |        |       |          |           |   ✅   |       |
| Claude Code        | claudecode   | ✅ 🌏 |   ✅   | ✅ 🌏 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |  ✅   |
| Codex CLI          | codexcli     | ✅ 🌏 |        | 🌏 🔧 |    🌏    |    🎮     | ✅ 🌏  |       |
| Gemini CLI         | geminicli    | ✅ 🌏 |   ✅   | ✅ 🌏 |  ✅ 🌏   |    🎮     | ✅ 🌏  |       |
| GitHub Copilot     | copilot      |  ✅   |        |  ✅   |    ✅    |    ✅     |   ✅   |       |
| Cursor             | cursor       |  ✅   |   ✅   |  ✅   |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |  ✅   |
| Factory Droid      | factorydroid | ✅ 🌏 |        | ✅ 🌏 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  |       |
| OpenCode           | opencode     |  ✅   |        | ✅ 🔧 |  ✅ 🌏   |   ✅ 🌏   | ✅ 🌏  | ✅ 🌏 |
| Cline              | cline        |  ✅   |   ✅   |  ✅   |  ✅ 🌏   |           |        |       |
| Kilo Code          | kilo         | ✅ 🌏 |   ✅   |  ✅   |  ✅ 🌏   |           | ✅ 🌏  |       |
| Roo Code           | roo          |  ✅   |   ✅   |  ✅   |    ✅    |    🎮     | ✅ 🌏  |       |
| Qwen Code          | qwencode     |  ✅   |   ✅   |       |          |           |        |       |
| Kiro               | kiro         |  ✅   |   ✅   |  ✅   |    ✅    |    ✅     |   ✅   |       |
| Google Antigravity | antigravity  |  ✅   |        |       |    ✅    |           | ✅ 🌏  |       |
| JetBrains Junie    | junie        |  ✅   |   ✅   |  ✅   |          |           |        |       |
| AugmentCode        | augmentcode  |  ✅   |   ✅   |       |          |           |        |       |
| Windsurf           | windsurf     |  ✅   |   ✅   |       |          |           |        |       |
| Warp               | warp         |  ✅   |        |       |          |           |        |       |
| Replit             | replit       |  ✅   |        |       |          |           |   ✅   |       |
| Zed                | zed          |       |   ✅   |       |          |           |        |       |

- ✅: Supports project mode
- 🌏: Supports global mode
- 🎮: Supports simulated commands/subagents/skills (Project mode only)
- 🔧: Supports MCP tool config (`enabledTools`/`disabledTools`)

## Why Rulesync?

### 🧭 **Single Source of Truth**

Author rules once, generate everywhere. Rulesync turns a unified ruleset into tool-native formats so teams stop duplicating instructions across multiple AI assistants.

### 🔧 **Tool Freedom Without Friction**

Let developers pick the assistant that fits their flow—Copilot, Cursor, Cline, Claude Code, and more—without rewriting team standards.

### 📦 **Clean, Auditable Outputs**

Rulesync emits plain configuration files you can commit, review, and ship. If you ever uninstall Rulesync, your generated files keep working.

### 🚀 **Fast Onboarding & Consistency**

New team members get the same conventions, context, and guardrails immediately, keeping code style and quality consistent across tools.

### 🧩 **Multi-Tool & Modular Workflows**

Compose rules, MCP configs, commands, and subagents for different tools or scopes (project vs. global) without fragmenting your workflow.

### 🌍 **Ready for What’s Next**

AI tool ecosystems evolve quickly. Rulesync helps you add, switch, or retire tools while keeping your rules intact.

## Case Studies

Rulesync is trusted by leading companies and recognized by the industry:

- **Anthropic Official Customer Story**: [Classmethod Inc. - Improving AI coding tool consistency with Rulesync](https://claude.com/customers/classmethod)
- **Asoview Inc.**: [Adopting Rulesync for unified AI development rules](https://tech.asoview.co.jp/entry/2025/12/06/100000)
- **KAKEHASHI Tech Blog**: [Building multilingual systems for the LLM era with a monorepo and a "living specification"](https://kakehashi-dev.hatenablog.com/entry/2025/12/08/110000)

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents,skills

# Fetch configurations from a Git repository
rulesync fetch owner/repo
rulesync fetch owner/repo@v1.0.0 --features rules,commands
rulesync fetch https://github.com/owner/repo --conflict skip

# Generate all features for all tools (new preferred syntax)
rulesync generate --targets "*" --features "*"

# Generate specific features for specific tools
rulesync generate --targets copilot,cursor,cline --features rules,mcp
rulesync generate --targets claudecode --features rules,subagents

# Generate only rules (no MCP, ignore files, commands, or subagents)
rulesync generate --targets "*" --features rules

# Generate simulated commands and subagents
rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --simulate-commands --simulate-subagents

# Dry run: show changes without writing files
rulesync generate --dry-run --targets claudecode --features rules

# Check if files are up to date (for CI/CD pipelines)
rulesync generate --check --targets "*" --features "*"

# Install skills from declarative sources in rulesync.jsonc
rulesync install

# Force re-resolve all source refs (ignore lockfile)
rulesync install --update

# Fail if lockfile is missing or out of sync (for CI)
rulesync install --frozen

# Install then generate (typical workflow)
rulesync install && rulesync generate

# Add generated files to .gitignore
rulesync gitignore

# Update rulesync to the latest version (single-binary installs)
rulesync update

# Check for updates without installing
rulesync update --check

# Force update even if already at latest version
rulesync update --force
```

## Dry Run

Rulesync provides two dry run options for the `generate` command that allow you to see what changes would be made without actually writing files:

### `--dry-run`

Show what would be written or deleted without actually writing any files. Changes are displayed with a `[DRY RUN]` prefix.

```bash
rulesync generate --dry-run --targets claudecode --features rules
```

### `--check`

Same as `--dry-run`, but exits with code 1 if files are not up to date. This is useful for CI/CD pipelines to verify that generated files are committed.

```bash
# In your CI pipeline
rulesync generate --check --targets "*" --features "*"
echo $?  # 0 if up to date, 1 if changes needed
```

> [!NOTE]
> `--dry-run` and `--check` cannot be used together.

## Fetch Command (In Development)

The `fetch` command allows you to fetch configuration files directly from a Git repository (GitHub/GitLab).

> [!NOTE]
> This feature is in development and may change in future releases.

**Note:** The fetch command searches for feature directories (`rules/`, `commands/`, `skills/`, `subagents/`, etc.) directly at the specified path, without requiring a `.rulesync/` directory structure. This allows fetching from external repositories like `vercel-labs/agent-skills` or `anthropics/skills`.

### Source Formats

```bash
# Full URL format
rulesync fetch https://github.com/owner/repo
rulesync fetch https://github.com/owner/repo/tree/branch
rulesync fetch https://github.com/owner/repo/tree/branch/path/to/subdir
rulesync fetch https://gitlab.com/owner/repo  # GitLab (planned)

# Prefix format
rulesync fetch github:owner/repo
rulesync fetch gitlab:owner/repo              # GitLab (planned)

# Shorthand format (defaults to GitHub)
rulesync fetch owner/repo
rulesync fetch owner/repo@ref        # Specify branch/tag/commit
rulesync fetch owner/repo:path       # Specify subdirectory
rulesync fetch owner/repo@ref:path   # Both ref and path
```

### Options

| Option                  | Description                                                                                | Default                          |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `--target, -t <target>` | Target format to interpret files as (e.g., 'rulesync', 'claudecode')                       | `rulesync`                       |
| `--features <features>` | Comma-separated features to fetch (rules, commands, subagents, skills, ignore, mcp, hooks) | `*` (all)                        |
| `--output <dir>`        | Output directory relative to project root                                                  | `.rulesync`                      |
| `--conflict <strategy>` | Conflict resolution: `overwrite` or `skip`                                                 | `overwrite`                      |
| `--ref <ref>`           | Git ref (branch/tag/commit) to fetch from                                                  | Default branch                   |
| `--path <path>`         | Subdirectory in the repository                                                             | `.` (root)                       |
| `--token <token>`       | Git provider token for private repositories                                                | `GITHUB_TOKEN` or `GH_TOKEN` env |

### Examples

```bash
# Fetch skills from external repositories
rulesync fetch vercel-labs/agent-skills --features skills
rulesync fetch anthropics/skills --features skills

# Fetch all features from a public repository
rulesync fetch dyoshikawa/rulesync --path .rulesync

# Fetch only rules and commands from a specific tag
rulesync fetch owner/repo@v1.0.0 --features rules,commands

# Fetch from a private repository (uses GITHUB_TOKEN env var)
export GITHUB_TOKEN=ghp_xxxx
rulesync fetch owner/private-repo

# Or use GitHub CLI to get the token
GITHUB_TOKEN=$(gh auth token) rulesync fetch owner/private-repo

# Preserve existing files (skip conflicts)
rulesync fetch owner/repo --conflict skip

# Fetch from a monorepo subdirectory
rulesync fetch owner/repo:packages/my-package
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
  "features": ["rules"],
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
  "features": ["rules", "ignore", "mcp", "commands", "subagents", "hooks"],

  // Base directories for generation.
  // Basically, you can specify a `["."]` only.
  // However, for example, if your project is a monorepo and you have to launch the AI agent at each package directory, you can specify multiple base directories.
  "baseDirs": ["."],

  // Delete existing files before generating
  "delete": true,

  // Verbose output
  "verbose": false,

  // Silent mode - suppress all output (except errors)
  "silent": false,

  // Advanced options
  "global": false, // Generate for global(user scope) configuration files
  "simulateCommands": false, // Generate simulated commands
  "simulateSubagents": false, // Generate simulated subagents
  "simulateSkills": false, // Generate simulated skills

  // Declarative skill sources — installed via 'rulesync install'
  // See the "Declarative Skill Sources" section for details.
  // "sources": [
  //   { "source": "owner/repo" },
  //   { "source": "org/repo", "skills": ["specific-skill"] },
  // ],
}
```

### Local Configuration

Rulesync supports a local configuration file (`rulesync.local.jsonc`) for machine-specific or developer-specific settings. This file is automatically added to `.gitignore` by `rulesync gitignore` and should not be committed to the repository.

**Configuration Priority** (highest to lowest):

1. CLI options
2. `rulesync.local.jsonc`
3. `rulesync.jsonc`
4. Default values

Example usage:

```jsonc
// rulesync.local.jsonc (not committed to git)
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  // Override targets for local development
  "targets": ["claudecode"],
  // Enable verbose output for debugging
  "verbose": true,
}
```

### Target Order and File Conflicts

When multiple targets write to the same output file, **the last target in the array wins**. This is the "last-wins" behavior.

For example, both `agentsmd` and `opencode` generate `AGENTS.md`:

```jsonc
{
  // opencode wins because it comes last
  "targets": ["agentsmd", "opencode"],
  "features": ["rules"],
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
  "features": ["rules"],
}
```

## Each File Format

### `rulesync/rules/*.md`

Example:

```md
---
root: true # true that is less than or equal to one file for overview such as `AGENTS.md`, false for details such as `.agents/memories/*.md`
localRoot: false # (optional, default: false) true for project-specific local rules. Claude Code: generates CLAUDE.local.md; Others: appends to root file
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

### `.rulesync/hooks.json`

Hooks run scripts at lifecycle events (e.g. session start, before tool use). Events use **canonical camelCase** in this file; Cursor uses them as-is; Claude Code gets PascalCase in `.claude/settings.json`; OpenCode hooks are generated as a JavaScript plugin at `.opencode/plugins/rulesync-hooks.js`.

**Event support:**

- **Cursor:** `sessionStart`, `preToolUse`, `postToolUse`, `stop`, `sessionEnd`, `beforeSubmitPrompt`, `subagentStop`, `preCompact`, `afterFileEdit`, `afterShellExecution`, `postToolUseFailure`, `subagentStart`, `beforeShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterAgentResponse`, `afterAgentThought`, `beforeTabFileRead`, `afterTabFileEdit`
- **Claude Code:** `sessionStart`, `preToolUse`, `postToolUse`, `stop`, `sessionEnd`, `beforeSubmitPrompt`, `subagentStop`, `preCompact`, `permissionRequest`, `notification`, `setup`
- **OpenCode:** `sessionStart`, `preToolUse`, `postToolUse`, `stop`, `afterFileEdit`, `afterShellExecution`, `permissionRequest`

> **Note:** Rulesync implements OpenCode hooks as a plugin, so importing from OpenCode to rulesync is not supported. OpenCode only supports command-type hooks (not prompt-type).

Use optional **override keys** so tool-specific events and config live in one file without leaking to others: `cursor.hooks` for Cursor-only events, `claudecode.hooks` for Claude-only, `opencode.hooks` for OpenCode-only. Events in shared `hooks` that a tool does not support are skipped for that tool (and a warning is logged at generate time).

Example:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "type": "command", "command": ".rulesync/hooks/session-start.sh" }],
    "postToolUse": [{ "matcher": "Write|Edit", "command": ".rulesync/hooks/format.sh" }],
    "stop": [{ "command": ".rulesync/hooks/audit.sh" }]
  },
  "cursor": {
    "hooks": {
      "afterFileEdit": [{ "command": ".cursor/hooks/format.sh" }]
    }
  },
  "claudecode": {
    "hooks": {
      "notification": [
        {
          "matcher": "permission_prompt",
          "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify.sh"
        }
      ]
    }
  },
  "opencode": {
    "hooks": {
      "afterShellExecution": [{ "command": ".rulesync/hooks/post-shell.sh" }]
    }
  }
}
```

### `rulesync/commands/*.md`

Example:

```md
---
description: "Review a pull request" # command description
targets: ["*"] # * = all, or specific tools
copilot: # copilot specific parameters (optional)
  description: "Review a pull request"
antigravity: # antigravity specific parameters
  trigger: "/review" # Specific trigger for workflow (renames file to review.md)
  turbo: true # (Optional, default: true) Append // turbo for auto-execution
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
  mode: subagent # (optional, defaults to "subagent") OpenCode agent mode
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
codexcli: # for codexcli-specific parameters
  short-description: A brief user-facing description
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
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {}
    }
  }
}
```

#### MCP Tool Config (`enabledTools` / `disabledTools`)

You can control which individual tools from an MCP server are enabled or disabled using `enabledTools` and `disabledTools` arrays per server.

```json
{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"],
      "enabledTools": ["search_symbols", "find_references"],
      "disabledTools": ["rename_symbol"]
    }
  }
}
```

- `enabledTools`: An array of tool names that should be explicitly enabled for this server.
- `disabledTools`: An array of tool names that should be explicitly disabled for this server.

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
   rulesync init
   ```

3. Edit `~/.aiglobal/rulesync.jsonc` to enable global mode.

   ```jsonc
   {
     "global": true,
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
   rulesync generate
   ```

> [!NOTE]
> Currently, when in the directory enabled global mode:
>
> - `rulesync.jsonc` only supports `global`, `features`, `delete` and `verbose`. `Features` can be set `"rules"` and `"commands"`. Other parameters are ignored.
> - `rules/*.md` only supports single file has `root: true`, and frontmatter parameters without `root` are ignored.
> - Only Claude Code is supported for global mode commands.

## Simulate Commands, Subagents and Skills

Simulated commands, subagents and skills allow you to generate simulated features for cursor, codexcli and etc. This is useful for shortening your prompts.

1. Prepare `.rulesync/commands/*.md`, `.rulesync/subagents/*.md` and `.rulesync/skills/*/SKILL.md` for your purposes.
2. Generate simulated commands, subagents and skills for specific tools that are included in cursor, codexcli and etc.

   ```bash
   rulesync generate \
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

## Official Skills

Rulesync provides official skills that you can install using the fetch command or declarative sources:

```bash
# One-time fetch
rulesync fetch dyoshikawa/rulesync --features skills

# Or declare in rulesync.jsonc and run 'rulesync install'
```

This will install the Rulesync documentation skill to your project.

## Declarative Skill Sources

Rulesync can fetch skills from external GitHub repositories using the `install` command. Instead of manually running `fetch` for each skill source, declare them in your `rulesync.jsonc` and run `rulesync install` to resolve and fetch them. Then `rulesync generate` picks them up as local curated skills. Typical workflow: `rulesync install && rulesync generate`.

### Configuration

Add a `sources` array to your `rulesync.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  "targets": ["copilot", "claudecode"],
  "features": ["rules", "skills"],
  "sources": [
    // Fetch all skills from a repository
    { "source": "owner/repo" },

    // Fetch only specific skills by name
    { "source": "anthropics/skills", "skills": ["skill-creator"] },

    // With ref pinning and subdirectory path (same syntax as fetch command)
    { "source": "owner/repo@v1.0.0:path/to/skills" },
  ],
}
```

Each entry in `sources` accepts:

| Property | Type       | Description                                                                                                 |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `source` | `string`   | Repository source using the same format as the `fetch` command (`owner/repo`, `owner/repo@ref:path`, etc.). |
| `skills` | `string[]` | Optional list of skill names to fetch. If omitted, all skills are fetched.                                  |

### How It Works

When `rulesync install` runs and `sources` is configured:

1. **Lockfile resolution** — Each source's ref is resolved to a commit SHA and stored in `rulesync.lock` (at the project root). On subsequent runs the locked SHA is reused for deterministic builds.
2. **Remote skill listing** — The `skills/` directory (or the path specified in the source URL) is listed from the remote repository.
3. **Filtering** — If `skills` is specified, only matching skill directories are fetched.
4. **Precedence rules**:
   - **Local skills always win** — Skills in `.rulesync/skills/` (not in `.curated/`) take precedence; a remote skill with the same name is skipped.
   - **First-declared source wins** — If two sources provide a skill with the same name, the one declared first in the `sources` array is used.
5. **Output** — Fetched skills are written to `.rulesync/skills/.curated/<skill-name>/`. This directory is automatically added to `.gitignore` by `rulesync gitignore`.

### CLI Options

The `install` command accepts these flags:

| Flag              | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `--update`        | Force re-resolve all source refs, ignoring the lockfile (useful to pull new updates). |
| `--frozen`        | Fail if lockfile is missing or out of sync. Useful for CI to ensure reproducibility.  |
| `--token <token>` | GitHub token for private repositories.                                                |

```bash
# Install skills using locked refs
rulesync install

# Force update to latest refs
rulesync install --update

# Strict CI mode — fail if lockfile doesn't cover all sources
rulesync install --frozen

# Install then generate
rulesync install && rulesync generate

# Skip source installation — just don't run install
rulesync generate
```

### Lockfile

The lockfile at `rulesync.lock` (at the project root) records the resolved commit SHA and per-skill integrity hashes for each source so that builds are reproducible. It is safe to commit this file. An example:

```json
{
  "lockfileVersion": 1,
  "sources": {
    "owner/skill-repo": {
      "requestedRef": "main",
      "resolvedRef": "abc123def456...",
      "resolvedAt": "2025-01-15T12:00:00.000Z",
      "skills": {
        "my-skill": { "integrity": "sha256-abcdef..." },
        "another-skill": { "integrity": "sha256-123456..." }
      }
    }
  }
}
```

To update locked refs, run `rulesync install --update`.

### Authentication

Source fetching uses the `GITHUB_TOKEN` or `GH_TOKEN` environment variable for authentication. This is required for private repositories and recommended for better rate limits.

```bash
# Using environment variable
export GITHUB_TOKEN=ghp_xxxx
npx rulesync install

# Or using GitHub CLI
GITHUB_TOKEN=$(gh auth token) npx rulesync install
```

> [!TIP]
> The `install` command also accepts a `--token` flag for explicit authentication: `rulesync install --token ghp_xxxx`.

### Curated vs Local Skills

| Location                            | Type    | Precedence | Committed to Git |
| ----------------------------------- | ------- | ---------- | ---------------- |
| `.rulesync/skills/<name>/`          | Local   | Highest    | Yes              |
| `.rulesync/skills/.curated/<name>/` | Curated | Lower      | No (gitignored)  |

When both a local and a curated skill share the same name, the local skill is used and the remote one is not fetched.

## Programmatic API

Rulesync can be used as a library in your Node.js/TypeScript projects. The `generate` and `importFromTool` functions are available as named exports.

```typescript
import { generate, importFromTool } from "rulesync";

// Generate configurations
const result = await generate({
  targets: ["claudecode", "cursor"],
  features: ["rules", "mcp"],
});
console.log(`Generated ${result.rulesCount} rules, ${result.mcpCount} MCP configs`);

// Import existing tool configurations into .rulesync/
const importResult = await importFromTool({
  target: "claudecode",
  features: ["rules", "commands"],
});
console.log(`Imported ${importResult.rulesCount} rules`);
```

### `generate(options?)`

Generates configuration files for the specified targets and features.

| Option              | Type           | Default           | Description                                  |
| ------------------- | -------------- | ----------------- | -------------------------------------------- |
| `targets`           | `ToolTarget[]` | from config file  | Tools to generate configurations for         |
| `features`          | `Feature[]`    | from config file  | Features to generate                         |
| `baseDirs`          | `string[]`     | `[process.cwd()]` | Base directories for generation              |
| `configPath`        | `string`       | auto-detected     | Path to `rulesync.jsonc`                     |
| `verbose`           | `boolean`      | `false`           | Enable verbose logging                       |
| `silent`            | `boolean`      | `true`            | Suppress all output                          |
| `delete`            | `boolean`      | from config file  | Delete existing files before generating      |
| `global`            | `boolean`      | `false`           | Generate global (user scope) configurations  |
| `simulateCommands`  | `boolean`      | `false`           | Generate simulated commands                  |
| `simulateSubagents` | `boolean`      | `false`           | Generate simulated subagents                 |
| `simulateSkills`    | `boolean`      | `false`           | Generate simulated skills                    |
| `dryRun`            | `boolean`      | `false`           | Show changes without writing files           |
| `check`             | `boolean`      | `false`           | Exit with code 1 if files are not up to date |

### `importFromTool(options)`

Imports existing tool configurations into `.rulesync/` directory.

| Option       | Type         | Default          | Description                               |
| ------------ | ------------ | ---------------- | ----------------------------------------- |
| `target`     | `ToolTarget` | (required)       | Tool to import configurations from        |
| `features`   | `Feature[]`  | from config file | Features to import                        |
| `configPath` | `string`     | auto-detected    | Path to `rulesync.jsonc`                  |
| `verbose`    | `boolean`    | `false`          | Enable verbose logging                    |
| `silent`     | `boolean`    | `true`           | Suppress all output                       |
| `global`     | `boolean`    | `false`          | Import global (user scope) configurations |

## Rulesync MCP Server

Rulesync provides an MCP (Model Context Protocol) server that enables AI agents to manage your Rulesync files. This allows AI agents to discover, read, create, update, and delete files dynamically.

> [!NOTE]
> The MCP server exposes the only one tool to minimize your agent's token usage. Approximately less than 1k tokens for the tool definition.

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

### Q. The generated `.mcp.json` doesn't work properly in Claude Code

You can try adding the following to `.claude/settings.json` or `.claude/settings.local.json`:

```diff
{
+ "enableAllProjectMcpServers": true
}
```

According to [the documentation](https://code.claude.com/docs/en/settings), this means:

> Automatically approve all MCP servers defined in project .mcp.json files

### Q. Google Antigravity doesn't load rules when `.agent` directories are in `.gitignore`

Google Antigravity has a known limitation where it won't load rules, workflows, and skills if the `.agent/rules/`, `.agent/workflows/`, and `.agent/skills/` directories are listed in `.gitignore`, even with "Agent Gitignore Access" enabled.

**Workaround:** Instead of adding these directories to `.gitignore`, add them to `.git/info/exclude`:

```bash
# Remove from .gitignore (if present)
# **/.agent/rules/
# **/.agent/workflows/
# **/.agent/skills/

# Add to .git/info/exclude
echo "**/.agent/rules/" >> .git/info/exclude
echo "**/.agent/workflows/" >> .git/info/exclude
echo "**/.agent/skills/" >> .git/info/exclude
```

`.git/info/exclude` works like `.gitignore` but is local-only, so it won't affect Antigravity's ability to load the rules while still excluding these directories from Git.

Note: `.git/info/exclude` can't be shared with your team since it's not committed to the repository.

## License

MIT License
