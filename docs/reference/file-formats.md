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
takt: # takt specific parameters (optional; emitted under .takt/facets/policies/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

...
```

## `.rulesync/hooks.json`

Hooks run scripts at lifecycle events (e.g. session start, before tool use). Events use **canonical camelCase** in this file, and Rulesync translates them per tool: Cursor uses them as-is; Claude Code, Factory Droid, Codex CLI, and Gemini CLI get PascalCase (with a few tool-specific name mappings) in their settings files; OpenCode and Kilo hooks are emitted as JavaScript plugins (`.opencode/plugins/rulesync-hooks.js`, `.kilo/plugins/rulesync-hooks.js`); Copilot and Copilot CLI map event names to their own camelCase (e.g. `beforeSubmitPrompt` → `userPromptSubmitted`, `afterError` → `errorOccurred`) and use `powershell`/`bash` command fields; deepagents-cli uses a dot-notation (e.g. `session.start`, `tool.error`).

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
- `cursor.hooks`, `claudecode.hooks`, `opencode.hooks`, `kilo.hooks`, `copilot.hooks`, `copilotcli.hooks`, `factorydroid.hooks`, `geminicli.hooks`, `codexcli.hooks`, `deepagents.hooks`: Tool-specific **override keys**. Entries under these keys are emitted only for the corresponding tool, so tool-only events (e.g. `afterFileEdit` for Cursor/OpenCode/Kilo, `worktreeCreate` for Claude Code, `afterError` for Copilot/Copilot CLI) can coexist with shared ones without leaking to other tools. `copilotcli.hooks` falls back to `copilot.hooks`, which in turn falls back to the shared `hooks` block.

**Hook entry keys:**

- `command` (required): Shell command to execute when the event fires.
- `type` (optional): Either `"command"` (default) or `"prompt"`. Not all tools support `prompt`; see notes below.
- `matcher` (optional): Regex used by tools that scope hooks to specific tool names (e.g. `preToolUse`, `postToolUse`, `notification`). Ignored by events that do not take a matcher (e.g. `sessionStart`, `worktreeCreate`, `worktreeRemove`).
- `timeout` (optional): Per-hook timeout in seconds, forwarded to tools that support it.

Events present in the shared `hooks` block but unsupported by a given tool are skipped for that tool (a warning is logged at generate time).

### Hook event × tool matrix

| Event                  | Cursor | Claude Code | OpenCode | Kilo | Copilot | Copilot CLI | Factory Droid | Gemini CLI | Codex CLI | deepagents |
| ---------------------- | :----: | :---------: | :------: | :--: | :-----: | :---------: | :-----------: | :--------: | :-------: | :--------: |
| `sessionStart`         |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |
| `sessionEnd`           |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |     —     |     ✅     |
| `beforeSubmitPrompt`   |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |
| `preToolUse`           |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     —      |
| `postToolUse`          |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     —      |
| `postToolUseFailure`   |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     ✅     |
| `stop`                 |   ✅   |     ✅      |    ✅    |  ✅  |    —    |      —      |      ✅       |     ✅     |    ✅     |     ✅     |
| `subagentStart`        |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `subagentStop`         |   ✅   |     ✅      |    —     |  —   |    —    |      —      |      ✅       |     —      |     —     |     —      |
| `preCompact`           |   ✅   |     ✅      |    —     |  —   |    —    |      —      |      ✅       |     ✅     |     —     |     ✅     |
| `afterFileEdit`        |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeShellExecution` |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `afterShellExecution`  |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeMCPExecution`   |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `afterMCPExecution`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeReadFile`       |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeAgentResponse`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |
| `afterAgentResponse`   |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |
| `afterAgentThought`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeTabFileRead`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `afterTabFileEdit`     |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `beforeToolSelection`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |
| `permissionRequest`    |   —    |     ✅      |    ✅    |  ✅  |    —    |      —      |      ✅       |     —      |    ✅     |     ✅     |
| `notification`         |   —    |     ✅      |    —     |  —   |    —    |      —      |      ✅       |     ✅     |     —     |     —      |
| `setup`                |   —    |     ✅      |    —     |  —   |    —    |      —      |      ✅       |     —      |     —     |     —      |
| `worktreeCreate`       |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `worktreeRemove`       |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |
| `afterError`           |   —    |      —      |    —     |  —   |   ✅    |     ✅      |       —       |     —      |     —     |     —      |

> **Note:** `worktreeCreate` and `worktreeRemove` are Claude Code-specific events and do not support the `matcher` field. Any matcher defined in the config is ignored for these events.

> **Note:** Rulesync implements OpenCode hooks as a plugin at `.opencode/plugins/rulesync-hooks.js` and Kilo hooks as a plugin at `.kilo/plugins/rulesync-hooks.js`, so importing from OpenCode/Kilo to rulesync is not supported. Both only support command-type hooks (not prompt-type).

> **Note:** GitHub Copilot's format uses separate `powershell` and `bash` fields for hooks. Rulesync supports only a single `command` field and resolves this by emitting the command under the `powershell` key on Windows, and under the `bash` key on all other platforms.

> **Note:** Hook file paths per tool:
>
> - **Copilot (cloud agent)** — `<project>/.github/hooks/copilot-hooks.json`.
> - **Copilot CLI** — project: `<project>/.github/hooks/copilotcli-hooks.json`; global: `~/.copilot/hooks/copilot-hooks.json`. The Copilot CLI docs let you choose any filename inside `.github/hooks/`, so Rulesync uses the CLI-specific name to avoid colliding with the cloud-agent file when both targets are enabled. The global path is a Rulesync convention; the official Copilot CLI documentation does not currently enumerate a global hooks location, so this placement may change if the spec later mandates an alternate layout.

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
takt: # takt specific parameters (optional; emitted under .takt/facets/instructions/)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
pi: # pi coding agent specific parameters (optional)
  argument-hint: "[message]" # Hint shown in Pi's command palette
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

...
```

The command body itself uses a Claude Code-compatible **universal syntax** (e.g. `$ARGUMENTS`, `` !`cmd` ``). When a target tool expects a different placeholder syntax, rulesync translates it automatically on generation and reverses the translation on import. See [Command Syntax](./command-syntax.md) for the full mapping.

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
takt: # takt specific parameters (optional; emitted under .takt/facets/personas/)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
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
  scheduled-task: true # (optional) emit to .claude/scheduled-tasks/<name>/SKILL.md instead of .claude/skills/<name>/SKILL.md
codexcli: # for codexcli-specific parameters
  short-description: A brief user-facing description
takt: # takt specific parameters (optional; emitted under .takt/facets/knowledge/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
---

This is the skill body content.

You can provide instructions, context, or any information that helps the AI agent understand and execute this skill effectively.

The skill can include:

- Step-by-step instructions
- Code examples
- Best practices
- Any relevant context

Skills are directory-based and can include additional files alongside SKILL.md.

When `claudecode.scheduled-task: true` is set, that skill is emitted only as a Claude Code scheduled task and is not emitted to other tools even if `targets` contains `"*"`.
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
- Rule `priority` is assigned per decision so that `deny` (1000000) beats `ask_user` (1000) beats `allow` (1) in the engine's first-match ordering. This matches intuitive allow-with-narrow-deny authoring (e.g. `bash: { "git *": "allow", "git push --force *": "deny" }`) without relying on array order. The spread is wide on purpose so a hand-authored rule in a sibling `.toml` under `policies/` is unlikely to outrank a rulesync-managed deny by accident.
- `bash` rules are generated with `toolName = "run_shell_command"`. When the pattern ends with a trailing ` *` (or has no glob metacharacters), the rule uses `commandPrefix` with the trailing ` *` stripped, so `"git *"` and `"git"` both serialize as `commandPrefix = "git"`. The reverse import canonicalizes these to `"<prefix> *"`.
- When a `bash` pattern contains interior glob metacharacters (anything other than a trailing ` *`, e.g. `"rm -rf /tmp/*"`), rulesync emits `argsPattern` with a `"command":"` JSON-anchor instead of `commandPrefix`, because Gemini CLI treats `commandPrefix` as a literal string prefix.
- Non-`bash` rules are generated with `toolName` + `argsPattern`. The pattern is anchored at both ends of the JSON string value (leading `"` and trailing `\"`) so a match cannot leak across JSON fields. Glob translation: `*` → `[^/\"]*` (single segment), `**` → `[^\"]*` (cross segment but still inside the string), `?` → `[^/\"]` (single non-separator character). Glob character classes (e.g. `[abc]`) are emitted as regex literals (the brackets themselves become `\[` / `\]`), because a translated class such as `[^a]` or `[!-~]` can bypass the JSON-boundary guard.
- Patterns that contain an unescaped `"` or `\` are skipped with a warning, because smol-toml escaping would let the pattern hijack the surrounding regex anchor and silently disable deny rules.
- Empty patterns (`""`) are skipped with a warning, since they would match every invocation on `bash` and never match anything on other tools.
- `bash` patterns `*` and `**` are skipped when paired with `allow` or `deny`, because either would silently grant or revoke permission for every shell command. They are still honored with `ask` (interactive prompt on every invocation).
- Imported policy rules whose `toolName` maps to a reserved JavaScript object key (`__proto__`, `constructor`, `prototype`) are skipped with a warning to prevent prototype pollution when round-tripping untrusted TOML.
- Tool categories are mapped as: `bash` → `run_shell_command`, `read` → `read_file`, `edit` → `replace`, `write` → `write_file`, `webfetch` → `web_fetch`

For Kiro, this generates tool permission settings in `.kiro/agents/default.json` (project mode):

- `bash` maps to `toolsSettings.shell.allowedCommands` / `toolsSettings.shell.deniedCommands`
- `read` maps to `toolsSettings.read.allowedPaths` / `toolsSettings.read.deniedPaths`
- `edit` / `write` map to `toolsSettings.write.allowedPaths` / `toolsSettings.write.deniedPaths`
- `webfetch` / `websearch` with pattern `*` map to `allowedTools` entries (`web_fetch` / `web_search`)
- `ask` rules are skipped with a warning (Kiro config does not support explicit ask entries)

For Cursor CLI, this generates `permissions` entries in `.cursor/cli.json` (project mode) or `~/.cursor/cli-config.json` (global mode). Cursor CLI only supports `allow` and `deny` decisions, so `ask` rules are skipped with a warning. Tool categories are mapped to PascalCase Cursor tool names (`bash` → `Shell`, `read` → `Read`, `edit`/`write` → `Write`, `webfetch` → `WebFetch`, `mcp__*` → `Mcp`). Existing Cursor-specific entries that Rulesync does not manage (for example, MCP entries with extra fields) are preserved on round-trip.

For Kilo Code, this generates the `permission` object in `kilo.jsonc` (project mode) or `~/.config/kilo/kilo.jsonc` (global mode). The shape is identical to OpenCode's (Kilo is an OpenCode fork), so categories like `bash`, `read`, `edit`, `write`, `webfetch`, and `mcp` accept either a string catch-all (`"allow" | "ask" | "deny"`) or a `{ <pattern>: <action> }` map. Other top-level keys in `kilo.jsonc` are preserved on round-trip. **The `permission` object is merged per top-level tool key**: for each tool key present in the rulesync output, that key is replaced entirely from rulesync (rulesync owns its managed keys; manual edits inside a managed key will be overwritten on the next generation). Tool keys that exist in the existing `kilo.jsonc` but are NOT in the rulesync output are preserved verbatim so user-added Kilo-only categories survive regeneration. When a regenerate replaces a key whose existing value contained `deny` patterns that disappear from the new rulesync output, an aggregated `logger.warn` enumerates the dropped patterns (matching the project convention used by every other permissions translator). Edits to other top-level keys (e.g. `model`) are preserved. **Malformed `kilo.jsonc` aborts the run**: the `jsonc-parser` library would otherwise silently coerce a syntax error to `{}` and overwrite the corrupted file with an empty `permission`, dropping the user's existing `deny` rules. Rulesync now surfaces parse errors so the run aborts before any destructive write — matching the strict `JSON.parse` behavior used by every other permissions translator.

For AugmentCode CLI, this generates `toolPermissions` entries in `.augment/settings.json` (project mode) or `~/.augment/settings.json` (global mode). Each entry has `toolName`, an optional `shellInputRegex` (only for shell commands), and `permission.type` ∈ `"allow" | "deny" | "ask-user"`. Tool category mapping: `bash` → `launch-process`, `read` → `view`, `edit` → `str-replace-editor`, `write` → `save-file`, `webfetch` → `web-fetch`, `websearch` → `web-search`. Action mapping: rulesync `ask` → AugmentCode `ask-user`. For `bash` patterns other than `*`, the glob pattern is converted to a regex and emitted as `shellInputRegex`. The glob → regex conversion maps `*` to `.*`, `?` to `.`, escapes `\^$.|+(){}[]`, and anchors at both ends; characters outside that set (notably `-`, `/`, `:`, `,`) are emitted verbatim, so Augment will match them literally. Generated entries are sorted **deny first, ask second, allow last**, with more specific patterns (those carrying `shellInputRegex`) before catch-alls — this is required because Augment's `toolPermissions` is evaluated **first-match-wins**. Existing `toolPermissions` entries whose `toolName` is NOT in the rulesync-managed set are preserved on round-trip; existing **`deny` entries for ANY managed `toolName`** (`launch-process`, `view`, `str-replace-editor`, `save-file`, `web-fetch`, `web-search`) are also preserved (fail-closed) so a user-added deny rule on any managed tool cannot be silently downgraded by regeneration. Existing managed-tool `allow` / `ask-user` entries are still replaced (rulesync owns the permissive surface for managed namespaces). **Non-bash categories do not have a documented per-input matcher in AugmentCode**, so Rulesync emits at most one catch-all entry per tool: if the rulesync category contains any `deny` rule, Rulesync emits a single `deny` entry for the entire tool (fail-closed) and warns; otherwise only `*`-pattern allow/ask rules are emitted and any non-`*` allow/ask patterns are dropped with a warning. Importing AugmentCode entries back into rulesync recovers `bash` patterns from `shellInputRegex` but the other categories always import as the catch-all `*` pattern. **The import direction also applies fail-closed precedence** when multiple existing entries collapse to the same `(canonical, "*")` key (e.g. `[{view: deny}, {view: allow}]`): the most restrictive action wins regardless of iteration order (precedence: `deny` > `ask` > `allow`), so a user-added deny in the source file is never silently dropped by import order. The `launch-process` (bash) path is unchanged because each entry has its own `shellInputRegex`-derived pattern with no `"*"` collapse.

For Cline CLI, this generates `.cline/command-permissions.json` (project mode only). Cline reads this file via the `CLINE_COMMAND_PERMISSIONS` environment variable; you can wire it up with `export CLINE_COMMAND_PERMISSIONS=$(cat .cline/command-permissions.json)`. The schema is `{ "allow": [...], "deny": [...], "allowRedirects": false }`. Cline only supports shell commands and only `allow`/`deny`. Non-`bash` categories are dropped and rulesync `ask` rules for `bash` are **translated to `deny`** (fail-closed safety, since Cline lacks `ask` semantics); both translation notices are surfaced via a single aggregated `logger.warn` per generation (matching the project convention used by every other permissions translator) so the translation stays visible without tripping CI gates that treat error lines as failures. **The `allow` array is wholesale-replaced by rulesync** — user-added entries inside `allow` are not preserved on regenerate. **The `deny` array is additive** — user-added denies in the existing file are preserved on every generation alongside the rulesync-derived denies (fail-closed standard). The `allowRedirects` field is preserved from the existing file (defaults to `false`). Cline does not have a stable per-user file location for command permissions, so global mode is not supported. If a pattern ends up in **both** `allow` and `deny` (defensive check; not reachable from a single rulesync config), Rulesync emits a warning because Cline does not document a deterministic deny-priority.

For Qwen Code, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in `.qwen/settings.json` (project mode) or `~/.qwen/settings.json` (global mode). The format mirrors Claude Code's: entries are `Bash(<pattern>)`, `Read(<pattern>)`, `Edit(<pattern>)`, `Write(<pattern>)`, `WebFetch(<pattern>)`, `WebSearch(<pattern>)`, `Grep(<pattern>)`, `Glob(<pattern>)`, `Agent(<pattern>)`, etc. Other top-level keys in `settings.json` are preserved on round-trip. Patterns may contain nested parentheses (e.g. `Bash(echo (a))`); Rulesync uses the **last** `)` as the closing delimiter when parsing, so inner parens round-trip. Malformed entries (missing closing paren, trailing characters) emit a warning; for **`deny`** they fall back to the catch-all pattern `*` (fail-closed: broadening a deny is the safer direction), but for **`allow` / `ask`** they are **dropped** rather than broadened — silently turning a narrow user rule into `*` would be a fail-open round-trip. Generation does not create the `.qwen/` directory until `writeAiFiles` runs, so dry-run is side-effect-free.

> **Note: Interaction with ignore feature.** Both the ignore feature and the permissions feature can manage `Read` tool deny entries in `.claude/settings.json`. When both features configure the `Read` tool, the **permissions feature takes precedence** and a warning is emitted. If you only need to restrict file reads based on glob patterns, use the ignore feature (`.rulesync/.aiignore`). Use permissions only when you need fine-grained `allow`/`ask`/`deny` control over the `Read` tool.
