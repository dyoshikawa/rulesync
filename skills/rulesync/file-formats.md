# File Formats

## `rulesync/rules/*.md`

Example:

```md
---
root: true # true that is less than or equal to one file for overview such as `AGENTS.md`, false for details such as `.agents/memories/*.md`
localRoot: false # (optional, default: false) true for project-specific local rules. Claude Code: CLAUDE.local.md; Rovodev (Rovo Dev CLI): AGENTS.local.md; Others: append to root file
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

## `.rulesync/hooks.json`

Hooks run scripts at lifecycle events (e.g. session start, before tool use). Events use **canonical camelCase** in this file, and Rulesync translates them per tool: Cursor uses them as-is; Claude Code, Factory Droid, Codex CLI, and Gemini CLI get PascalCase (with a few tool-specific name mappings) in their settings files; OpenCode and Kilo hooks are emitted as JavaScript plugins (`.opencode/plugins/rulesync-hooks.js`, `.kilo/plugins/rulesync-hooks.js`); Copilot maps event names to its own camelCase (e.g. `beforeSubmitPrompt` → `userPromptSubmitted`, `afterError` → `errorOccurred`) and uses `powershell`/`bash` command fields; deepagents-cli uses a dot-notation (e.g. `session.start`, `tool.error`).

Example:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "type": "command", "command": ".rulesync/hooks/session-start.sh" }],
    "preToolUse": [{ "matcher": "Bash", "command": ".rulesync/hooks/confirm.sh" }],
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
  },
  "copilot": {
    "hooks": {
      "afterError": [{ "command": ".rulesync/hooks/report-error.sh" }]
    }
  },
  "geminicli": {
    "hooks": {
      "beforeToolSelection": [{ "command": ".rulesync/hooks/before-tool.sh" }]
    }
  }
}
```

**Top-level keys:**

- `version`: Schema version (currently `1`).
- `hooks`: Map of canonical event names to an array of hook entries. These are dispatched to every tool that supports the given event.
- `cursor.hooks`, `claudecode.hooks`, `opencode.hooks`, `kilo.hooks`, `copilot.hooks`, `factorydroid.hooks`, `geminicli.hooks`, `codexcli.hooks`, `deepagents.hooks`: Tool-specific **override keys**. Entries under these keys are emitted only for the corresponding tool, so tool-only events (e.g. `afterFileEdit` for Cursor/OpenCode/Kilo, `worktreeCreate` for Claude Code, `afterError` for Copilot) can coexist with shared ones without leaking to other tools.

**Hook entry keys:**

- `command` (required): Shell command to execute when the event fires.
- `type` (optional): Either `"command"` (default) or `"prompt"`. Not all tools support `prompt`; see notes below.
- `matcher` (optional): Regex used by tools that scope hooks to specific tool names (e.g. `preToolUse`, `postToolUse`, `notification`). Ignored by events that do not take a matcher (e.g. `sessionStart`, `worktreeCreate`, `worktreeRemove`).
- `timeout` (optional): Per-hook timeout in seconds, forwarded to tools that support it.

Events present in the shared `hooks` block but unsupported by a given tool are skipped for that tool (a warning is logged at generate time).

### Hook event × tool matrix

| Event                  | Cursor | Claude Code | OpenCode | Kilo | Copilot | Factory Droid | Gemini CLI | Codex CLI | deepagents |
| ---------------------- | :----: | :---------: | :------: | :--: | :-----: | :-----------: | :--------: | :-------: | :--------: |
| `sessionStart`         |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |      ✅       |     ✅     |    ✅     |     ✅     |
| `sessionEnd`           |   ✅   |     ✅      |    —     |  —   |   ✅    |      ✅       |     ✅     |     —     |     ✅     |
| `beforeSubmitPrompt`   |   ✅   |     ✅      |    —     |  —   |   ✅    |      ✅       |     ✅     |    ✅     |     ✅     |
| `preToolUse`           |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |      ✅       |     ✅     |    ✅     |     —      |
| `postToolUse`          |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |      ✅       |     ✅     |    ✅     |     —      |
| `postToolUseFailure`   |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     ✅     |
| `stop`                 |   ✅   |     ✅      |    ✅    |  ✅  |    —    |      ✅       |     ✅     |    ✅     |     ✅     |
| `subagentStart`        |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `subagentStop`         |   ✅   |     ✅      |    —     |  —   |    —    |      ✅       |     —      |     —     |     —      |
| `preCompact`           |   ✅   |     ✅      |    —     |  —   |    —    |      ✅       |     ✅     |     —     |     ✅     |
| `afterFileEdit`        |   ✅   |      —      |    ✅    |  ✅  |    —    |       —       |     —      |     —     |     —      |
| `beforeShellExecution` |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `afterShellExecution`  |   ✅   |      —      |    ✅    |  ✅  |    —    |       —       |     —      |     —     |     —      |
| `beforeMCPExecution`   |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `afterMCPExecution`    |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `beforeReadFile`       |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `beforeAgentResponse`  |   —    |      —      |    —     |  —   |    —    |       —       |     ✅     |     —     |     —      |
| `afterAgentResponse`   |   ✅   |      —      |    —     |  —   |    —    |       —       |     ✅     |     —     |     —      |
| `afterAgentThought`    |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `beforeTabFileRead`    |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `afterTabFileEdit`     |   ✅   |      —      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `beforeToolSelection`  |   —    |      —      |    —     |  —   |    —    |       —       |     ✅     |     —     |     —      |
| `permissionRequest`    |   —    |     ✅      |    ✅    |  ✅  |    —    |      ✅       |     —      |     —     |     ✅     |
| `notification`         |   —    |     ✅      |    —     |  —   |    —    |      ✅       |     ✅     |     —     |     —      |
| `setup`                |   —    |     ✅      |    —     |  —   |    —    |      ✅       |     —      |     —     |     —      |
| `worktreeCreate`       |   —    |     ✅      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `worktreeRemove`       |   —    |     ✅      |    —     |  —   |    —    |       —       |     —      |     —     |     —      |
| `afterError`           |   —    |      —      |    —     |  —   |   ✅    |       —       |     —      |     —     |     —      |

> **Note:** `worktreeCreate` and `worktreeRemove` are Claude Code-specific events and do not support the `matcher` field. Any matcher defined in the config is ignored for these events.

> **Note:** Rulesync implements OpenCode hooks as a plugin at `.opencode/plugins/rulesync-hooks.js` and Kilo hooks as a plugin at `.kilo/plugins/rulesync-hooks.js`, so importing from OpenCode/Kilo to rulesync is not supported. Both only support command-type hooks (not prompt-type).

> **Note:** GitHub Copilot's format uses separate `powershell` and `bash` fields for hooks. Rulesync supports only a single `command` field and resolves this by emitting the command under the `powershell` key on Windows, and under the `bash` key on all other platforms.

> **Note:** Because each AI tool evolves its own hook surface at its own pace, the matrix above reflects the events Rulesync currently translates. When a tool ships a new event that Rulesync does not yet support, the most reliable path is to open an issue — the matrix is the intended baseline to compare against.

## `.copilot/mcp-config.json`

Example:

```json
{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    },
    "github": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    },
    "local-dev": {
      "type": "local",
      "command": "node",
      "args": ["scripts/start-local-mcp.js"]
    }
  }
}
```

This file is used by the GitHub Copilot CLI for MCP server configuration. Rulesync manages this file by converting from the unified `.rulesync/mcp.json` format.

- **Project mode:** `.copilot/mcp-config.json` (relative to project root)
- **Global mode:** `~/.copilot/mcp-config.json` (relative to home directory)

Rulesync preserves explicit `type` values for `http`, `sse`, and `local` servers. For command-based servers that omit a transport type, Rulesync emits the mandatory `"type": "stdio"` field required by the Copilot CLI.

## `rulesync/commands/*.md`

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

## `rulesync/subagents/*.md`

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

> **Gemini CLI note (as of 2026-04-01):** Subagents are generated to `.gemini/agents/`. To enable the agents feature, set `"experimental": { "enableAgents": true }` in your `.gemini/settings.json`.

## `.rulesync/skills/*/SKILL.md`

Example:

```md
---
name: example-skill # skill name
description: >- # skill description
  A sample skill that demonstrates the skill format
targets: ["*"] # * = all, or specific tools
claudecode: # for claudecode-specific parameters
  model: sonnet # opus, sonnet, haiku, or any string
  allowed-tools:
    - "Bash"
    - "Read"
    - "Write"
    - "Grep"
  disable-model-invocation: true # (optional) disable model invocation for this skill
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

## `.rulesync/mcp.json`

Example:

```json
{
  "mcpServers": {
    "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json",
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

#### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `.rulesync/mcp.json`:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json",
  "mcpServers": {}
}
```

### MCP Tool Config (`enabledTools` / `disabledTools`)

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

## `.rulesync/.aiignore` or `.rulesyncignore`

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

### Where ignore patterns are written per tool

Most tools get a dedicated ignore file (for example `.cursorignore`,
`.geminiignore`, `.clineignore`). Claude Code is the exception: it does not
read a separate ignore file, so Rulesync writes the deny list into Claude
Code's settings file as `permissions.deny` entries (`Read(<pattern>)`).

By default, Claude Code's deny list is written to the **shared**
`.claude/settings.json` so that the policy can be committed and reviewed by
the team. This is intentional (see issue #1094), but it means that running
`rulesync gitignore` will not add `.claude/settings.json` to `.gitignore` —
that file may also contain other shared Claude config you actively want to
commit.

If you would rather keep the deny list out of version control, opt into the
**local** mode using the per-feature options object form:

```jsonc
// rulesync.jsonc
{
  "targets": ["claudecode"],
  "features": {
    "claudecode": {
      "ignore": { "fileMode": "local" },
    },
  },
}
```

| `fileMode`           | Output file                   | Tracked by git by default                             |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| `"shared"` (default) | `.claude/settings.json`       | Yes — meant to be committed and shared with the team. |
| `"local"`            | `.claude/settings.local.json` | No — `rulesync gitignore` already excludes this file. |

## `.rulesync/permissions.json`

Permissions define which tool actions are allowed, require confirmation, or are denied. The canonical format uses **lowercase tool category names** and **glob patterns** mapped to permission actions.

**Permission actions:**

- `allow` -- Automatically permitted without user confirmation
- `ask` -- Requires user confirmation before execution
- `deny` -- Blocked from execution

**Supported tool categories:** `bash`, `read`, `edit`, `write`, `webfetch`, `websearch`, `grep`, `glob`, `notebookedit`, `agent`, and MCP-specific tool names (e.g., `mcp__puppeteer__puppeteer_navigate`)

Example:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/permissions-schema.json",
  "permission": {
    "bash": {
      "git *": "allow",
      "npm run *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    },
    "edit": {
      "src/**": "allow"
    },
    "read": {
      ".env": "deny"
    }
  }
}
```

#### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `.rulesync/permissions.json`:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/permissions-schema.json",
  "permission": {}
}
```

For Claude Code, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in `.claude/settings.json` (project mode) or `~/.claude/settings.json` (global mode) using PascalCase tool names (e.g., `Bash(git *)`, `Edit(src/**)`, `Read(.env)`).

For OpenCode, this generates the `permission` object in `opencode.json` / `opencode.jsonc` (project mode) or `.config/opencode/opencode.json` / `.config/opencode/opencode.jsonc` (global mode), preserving other existing OpenCode config fields.

For Codex CLI, this generates a `rulesync` named profile in `.codex/config.toml` under `[permissions.rulesync]` and sets `default_permissions = "rulesync"` (project/global depending on mode). It also generates `.codex/rules/rulesync.rules` from `permission.bash` entries using `prefix_rule(...)`. Current Rulesync-to-Codex mapping supports `bash`, `read`, `edit`/`write`, and `webfetch` categories:

- `bash`: generates one `prefix_rule(...)` per command pattern in `.codex/rules/rulesync.rules` (`allow` → `allow`, `ask` → `prompt`, `deny` → `forbidden`)
- `read`: `allow` → `read`, `ask`/`deny` → `none` in `permissions.<profile>.filesystem`
- `edit` / `write`: `allow` → `write`, `ask`/`deny` → `none` in `permissions.<profile>.filesystem`
- `webfetch`: `allow`/`deny` map to `permissions.<profile>.network.domains` (Codex does not support `ask` for domain rules)

For Gemini CLI, this generates a Policy Engine file at `.gemini/policies/rulesync.toml` (project mode) or `~/.gemini/policies/rulesync.toml` (global mode). Gemini CLI auto-discovers any `*.toml` file under the `policies/` directory, so no `settings.json` modification is required:

- `allow` / `deny` / `ask` rules are converted into Policy Engine `decision` values `allow` / `deny` / `ask_user`
- `bash` rules are generated with `toolName = "run_shell_command"` (using `commandPrefix` when the rule pattern is not `*`)
- Non-`bash` rules are generated with `toolName` + `argsPattern`
- Tool categories are mapped as: `bash` → `run_shell_command`, `read` → `read_file`, `edit` → `replace`, `write` → `write_file`, `webfetch` → `web_fetch`

For Kiro, this generates tool permission settings in `.kiro/agents/default.json` (project mode):

- `bash` maps to `toolsSettings.shell.allowedCommands` / `toolsSettings.shell.deniedCommands`
- `read` maps to `toolsSettings.read.allowedPaths` / `toolsSettings.read.deniedPaths`
- `edit` / `write` map to `toolsSettings.write.allowedPaths` / `toolsSettings.write.deniedPaths`
- `webfetch` / `websearch` with pattern `*` map to `allowedTools` entries (`web_fetch` / `web_search`)
- `ask` rules are skipped with a warning (Kiro config does not support explicit ask entries)

> **Note: Interaction with ignore feature.** Both the ignore feature and the permissions feature can manage `Read` tool deny entries in `.claude/settings.json`. When both features configure the `Read` tool, the **permissions feature takes precedence** and a warning is emitted. If you only need to restrict file reads based on glob patterns, use the ignore feature (`.rulesync/.aiignore`). Use permissions only when you need fine-grained `allow`/`ask`/`deny` control over the `Read` tool.
