# File Formats

## Symlinks

Rulesync follows symbolic links when it discovers source files, whether you use a plain `.rulesync/` directory or a separate `--input-root`. Glob-based discovery (rules, commands, subagents, skills) follows symlinked files and directories; single fixed-path files such as `.rulesyncignore`, `.rulesync/mcp.json`, and `.rulesync/permissions.json` are likewise resolved transparently by the OS when read. A symlink inside the input tree that points elsewhere is followed transparently, and the resolved file content is copied into the generated output. This is intentional: it lets you centralize shared skills or rules in one place and reference them via symlinks without duplication (see [issue #1707](https://github.com/dyoshikawa/rulesync/issues/1707)).

The trust boundary is the directory you point Rulesync at. There is **no** `realpath`-based containment check on individual symlinks, so a link may resolve to a target outside the input root — enforcing containment would break the shared-file use case above. Only run Rulesync against trees you control. Directory symlink **cycles** are handled safely: results are deduplicated by real path, so a cycle does not produce duplicated output. Note that the remote-fetch path (`rulesync fetch` from a Git repository) is a separate, hardened code path that **skips** symlinks entirely, so untrusted remote content never has its symlinks followed.

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
devin: # devin (Devin Desktop, formerly Windsurf) specific parameters
  trigger: "always_on" # always_on, glob, manual, or model_decision
  globs: ["**/*"] # (optional) file patterns to match when trigger is "glob"
  description: "When to apply this rule" # (optional) used with "model_decision" trigger
augmentcode: # augmentcode specific parameters
  type: "always_apply" # always_apply, manual, or agent_requested
  description: "When to apply this rule" # (optional) used with "agent_requested" type
kiro: # kiro specific parameters (steering inclusion)
  inclusion: "fileMatch" # always, fileMatch, or manual
  fileMatchPattern: ["src/components/**/*.tsx"] # (optional) glob string or array of globs, used when inclusion is "fileMatch"
takt: # takt specific parameters (optional; emitted under .takt/facets/policies/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
  extends: "base" # (optional) emit a leading `{extends:<parent>}` facet-inheritance directive (Takt 0.39.0+)
  facet: "output-contracts" # (optional) "policies" (default) or "output-contracts": redirect this rule to Takt's output-structure/report-template facet
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

...
```

> **Kiro note:** Kiro reads steering files from `.kiro/steering/*.md` and uses an `inclusion` frontmatter block to decide when each is loaded (`always`, `fileMatch` with a `fileMatchPattern`, or `manual`). Rulesync derives this for non-root steering files: an explicit `kiro.inclusion` block round-trips as-is; otherwise specific (non-wildcard) `globs` map to `inclusion: fileMatch` (a single glob is written as a string and multiple as a YAML array, both of which Kiro accepts), so the rule applies only to matching files instead of always; otherwise the file stays always-on and is written without a frontmatter block (Kiro's no-frontmatter default). The root overview index is always written plain so Kiro always loads it.

> **Kilo Code note:** Kilo writes the root rule to the auto-loaded `AGENTS.md` and non-root rules to `.kilo/rules/*.md`. Because Kilo v7 does not auto-load files under `.kilo/rules/`, Rulesync also registers each generated non-root rule file in the `instructions` array of the shared `kilo.jsonc` (the root `AGENTS.md` is auto-loaded and is therefore not registered). This merge is non-destructive: existing keys such as `mcp`, `tools`, and `permission` are preserved, and the `instructions` list is deduped and sorted.

> **OpenCode note:** OpenCode writes the root rule to the auto-loaded `AGENTS.md` and non-root rules to `.opencode/memories/*.md`. Because OpenCode auto-loads only the root `AGENTS.md` plus files explicitly listed in the `instructions` array of `opencode.json` (it does not auto-discover a rules directory), Rulesync also registers each generated non-root rule file in the `instructions` array of the shared `opencode.json`/`opencode.jsonc` (the root `AGENTS.md` is auto-loaded and is therefore not registered). This merge is non-destructive: existing keys such as `mcp`, `tools`, and `permission` are preserved, and the `instructions` list is deduped and sorted.

## `.rulesync/hooks.json`

Hooks run scripts at lifecycle events (e.g. session start, before tool use). Events use **canonical camelCase** in this file, and Rulesync translates them per tool: Cursor uses them as-is; Claude Code, Factory Droid, Codex CLI, Gemini CLI, and Goose get PascalCase (with a few tool-specific name mappings) in their settings files; OpenCode and Kilo hooks are emitted as JavaScript plugins (`.opencode/plugins/rulesync-hooks.js`, `.kilo/plugins/rulesync-hooks.js`); Copilot and Copilot CLI map event names to their own camelCase (e.g. `beforeSubmitPrompt` → `userPromptSubmitted`, `stop` → `agentStop`, `afterError` → `errorOccurred`) and use `powershell`/`bash` command fields — Copilot CLI additionally covers a wider event set and supports `prompt` and `http` hook types beyond `command`; deepagents-cli uses a dot-notation (e.g. `session.start`, `tool.error`); Kiro emits hooks into `.kiro/agents/default.json` using Kiro's CLI event names (`agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`); Qwen Code emits PascalCase events into the `hooks` key of `.qwen/settings.json` (its supported event set differs from Gemini CLI's).

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
- `cursor.hooks`, `claudecode.hooks`, `opencode.hooks`, `kilo.hooks`, `copilot.hooks`, `copilotcli.hooks`, `factorydroid.hooks`, `geminicli.hooks`, `codexcli.hooks`, `goose.hooks`, `deepagents.hooks`, `kiro.hooks`, `qwencode.hooks`: Tool-specific **override keys**. Entries under these keys are emitted only for the corresponding tool, so tool-only events (e.g. `afterFileEdit` for Cursor/OpenCode/Kilo, `worktreeCreate` for Claude Code, `afterError` for Copilot/Copilot CLI) can coexist with shared ones without leaking to other tools. `copilotcli.hooks` falls back to `copilot.hooks`, which in turn falls back to the shared `hooks` block.

**Hook entry keys:**

- `command` (required): Shell command to execute when the event fires.
- `type` (optional): Either `"command"` (default) or `"prompt"`. Not all tools support `prompt`; see notes below.
- `matcher` (optional): Regex used by tools that scope hooks to specific tool names (e.g. `preToolUse`, `postToolUse`, `notification`). Ignored by events that do not take a matcher (e.g. `sessionStart`, `worktreeCreate`, `worktreeRemove`).
- `timeout` (optional): Per-hook timeout in seconds, forwarded to tools that support it.
- `failClosed` (optional): Cursor-specific boolean. When `true`, a hook failure (crash, timeout, invalid JSON) blocks the action instead of allowing it through. Passed through to Cursor's `.cursor/hooks.json`.

Events present in the shared `hooks` block but unsupported by a given tool are skipped for that tool (a warning is logged at generate time). The canonical `notification` event maps to deepagents-cli's `input.required` (human-in-the-loop interrupt).

### Hook event × tool matrix

| Event                  | Cursor | Claude Code | OpenCode | Kilo | Copilot | Copilot CLI | Factory Droid | Gemini CLI | Codex CLI | deepagents | Kiro | Antigravity IDE | Antigravity CLI | Devin | AugmentCode | Goose |
| ---------------------- | :----: | :---------: | :------: | :--: | :-----: | :---------: | :-----------: | :--------: | :-------: | :--------: | :--: | :-------------: | :-------------: | :---: | :---------: | :---: |
| `sessionStart`         |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |        —        |        —        |   —   |     ✅      |  ✅   |
| `sessionEnd`           |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |     —     |     ✅     |  ✅  |        —        |        —        |   —   |     ✅      |  ✅   |
| `beforeSubmitPrompt`   |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |        —        |        —        |  ✅   |      —      |  ✅   |
| `preToolUse`           |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     —      |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `postToolUse`          |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     —      |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `preModelInvocation`   |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |       ✅        |       ✅        |   —   |      —      |   —   |
| `postModelInvocation`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |       ✅        |       ✅        |   —   |      —      |   —   |
| `postToolUseFailure`   |   ✅   |      —      |    —     |  —   |    —    |     ✅      |       —       |     —      |     —     |     ✅     |  —   |        —        |        —        |   —   |      —      |  ✅   |
| `stop`                 |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `subagentStart`        |   ✅   |      —      |    —     |  —   |    —    |     ✅      |       —       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |  ✅   |
| `subagentStop`         |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |  ✅   |
| `preCompact`           |   ✅   |     ✅      |    —     |  —   |    —    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  —   |        —        |        —        |   —   |      —      |   —   |
| `postCompact`          |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `afterFileEdit`        |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `beforeShellExecution` |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `afterShellExecution`  |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `beforeMCPExecution`   |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `afterMCPExecution`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `beforeReadFile`       |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `beforeAgentResponse`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `afterAgentResponse`   |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `afterAgentThought`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `beforeTabFileRead`    |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `afterTabFileEdit`     |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `beforeToolSelection`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     ✅     |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `permissionRequest`    |   —    |     ✅      |    ✅    |  ✅  |    —    |     ✅      |       —       |     —      |    ✅     |     ✅     |  —   |        —        |        —        |   —   |      —      |   —   |
| `notification`         |   —    |     ✅      |    —     |  —   |    —    |     ✅      |      ✅       |     ✅     |     —     |     ✅     |  —   |        —        |        —        |   —   |      —      |   —   |
| `setup`                |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `worktreeCreate`       |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
| `worktreeRemove`       |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `workspaceOpen`        |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `messageDisplay`       |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `afterError`           |   —    |      —      |    —     |  —   |   ✅    |     ✅      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |

> **Note:** `worktreeCreate`, `worktreeRemove`, and `messageDisplay` are Claude Code-specific events and do not support the `matcher` field. Any matcher defined in the config is ignored for these events.

> **Note:** Rulesync implements OpenCode hooks as a plugin at `.opencode/plugins/rulesync-hooks.js` and Kilo hooks as a plugin at `.kilo/plugins/rulesync-hooks.js`, so importing from OpenCode/Kilo to rulesync is not supported. Both only support command-type hooks (not prompt-type).

> **Note:** GitHub Copilot's format uses separate `powershell` and `bash` fields for hooks. Rulesync supports only a single `command` field and resolves this by emitting the command under the `powershell` key on Windows, and under the `bash` key on all other platforms.

> **Note:** Hook file paths per tool:
>
> - **Copilot (cloud agent)** — `<project>/.github/hooks/copilot-hooks.json`.
> - **Copilot CLI** — project: `<project>/.github/hooks/copilotcli-hooks.json`; global: `~/.copilot/hooks/copilot-hooks.json`. The Copilot CLI docs let you choose any filename inside `.github/hooks/`, so Rulesync uses the CLI-specific name to avoid colliding with the cloud-agent file when both targets are enabled. The global path is a Rulesync convention; the official Copilot CLI documentation does not currently enumerate a global hooks location, so this placement may change if the spec later mandates an alternate layout. Copilot CLI uses a **wider event surface** than the shared cloud-agent set (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `agentStop` ← `stop`, `subagentStart`, `subagentStop`, `errorOccurred` ← `afterError`, `preCompact`, `permissionRequest`, `notification`) and supports three hook types: **`command`** (`bash`/`powershell` with optional `timeoutSec`, plus pass-through `cwd`/`env`), **`prompt`** (a `prompt` string — Copilot CLI only honors prompt hooks on `sessionStart`, so prompt hooks on other events are dropped), and **`http`** (`url`/`headers`/`allowedEnvVars` with optional `timeoutSec`).
> - **Antigravity IDE / Antigravity CLI** — project: `<project>/.agents/hooks.json`; global: `~/.gemini/config/hooks.json`. Both targets share the same dedicated `hooks.json` (a Claude-Code-style matcher map nested under a generated `rulesync` hook name), so enabling both writes the same file.
> - **Devin Desktop (formerly Windsurf)** — project: `<project>/.windsurf/hooks.json`; global: `~/.codeium/windsurf/hooks.json`. The Cascade Hooks file location is unchanged by the Devin Desktop rebrand.
> - **AugmentCode** — project: `<project>/.augment/settings.json`; global: `~/.augment/settings.json`. Hooks are merged under the top-level `hooks` key of the shared settings file (which also holds `toolPermissions`).
> - **Vibe Code** — project: `<project>/.vibe/hooks.toml`; global: `~/.vibe/hooks.toml`. Hooks are **experimental** and require `enable_experimental_hooks = true` in `.vibe/config.toml` (or `VIBE_ENABLE_EXPERIMENTAL_HOOKS=true`); Rulesync merges this flag into the shared `.vibe/config.toml` without clobbering existing MCP/permissions settings.

> **Note:** Because each AI tool evolves its own hook surface at its own pace, the matrix above reflects the events Rulesync currently translates. When a tool ships a new event that Rulesync does not yet support, the most reliable path is to open an issue — the matrix is the intended baseline to compare against.

> **Note:** Kiro hooks are emitted into `.kiro/agents/default.json` under the `hooks` field, merging with any existing agent configuration (tools, allowedTools, etc.). Both `sessionEnd` and `stop` canonical events map to Kiro CLI's `stop` event. Only `command`-type hooks are supported; `prompt`-type hooks are silently skipped. Kiro CLI uses `timeout_ms` (in milliseconds) for per-hook timeouts.

> **Note:** Antigravity (IDE and CLI) writes a dedicated `hooks.json` keyed by a **named hook** whose value holds the event map, e.g. `{ "rulesync": { "PreToolUse": [ { "matcher": "...", "hooks": [...] } ], "Stop": [ { "hooks": [...] } ] } }`. Rulesync emits a single generated hook under the stable name `rulesync`. It supports five lifecycle events — `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `preModelInvocation` ⇄ `PreInvocation`, `postModelInvocation` ⇄ `PostInvocation`, and `stop` ⇄ `Stop` — where `PreInvocation`/`PostInvocation`/`Stop` are matcher-less handler lists. On import, both the named-hook wrapper and a legacy flat top-level event map are accepted, and the optional per-hook `enabled` flag is ignored.

> **Note:** Devin Desktop (formerly Windsurf) Cascade Hooks (GA) are written to a dedicated `hooks.json` whose top-level `hooks` key maps each Cascade event name to a **flat array** of hook objects (no `matcher`, no `type`, no inner `hooks` wrapper, and no `timeout`). Each object carries `command` and/or `powershell`, plus optional `show_output` and `working_directory`. Rulesync splits the generic tool lifecycle into Devin's file/command/MCP-specific events, so the canonical events map bijectively: `beforeReadFile` ⇄ `pre_read_code`, `beforeTabFileRead` ⇄ `post_read_code`, `afterTabFileEdit` ⇄ `pre_write_code`, `afterFileEdit` ⇄ `post_write_code`, `beforeShellExecution` ⇄ `pre_run_command`, `afterShellExecution` ⇄ `post_run_command`, `beforeMCPExecution` ⇄ `pre_mcp_tool_use`, `afterMCPExecution` ⇄ `post_mcp_tool_use`, `beforeSubmitPrompt` ⇄ `pre_user_prompt`, `afterAgentResponse` ⇄ `post_cascade_response`, `beforeAgentResponse` ⇄ `post_cascade_response_with_transcript`, and `worktreeCreate` ⇄ `post_setup_worktree`. Canonical events with no Devin equivalent (e.g. `sessionStart`, `stop`) are dropped with a logged warning. The Cascade Hooks file location (`.windsurf/hooks.json` / `~/.codeium/windsurf/hooks.json`) is retained from the Windsurf era and is unaffected by the rebrand.

> **Note:** AugmentCode (Auggie CLI) hooks are merged under the top-level `hooks` key of the shared `.augment/settings.json` (project) / `~/.augment/settings.json` (global), mirroring Claude Code's per-event matcher arrays (`{ "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": ... } ] } ] }`). The `hooks` block is merged in place so it coexists with the `toolPermissions` block from the permissions feature. Five lifecycle events are supported — `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, and `stop` ⇄ `Stop`. The `matcher` field (a case-sensitive regex, default `.*`, with `mcp:*` support) applies only to the tool events `PreToolUse`/`PostToolUse`; any matcher on the session events is dropped with a logged warning. Commands are emitted verbatim — Auggie exposes `AUGMENT_PROJECT_DIR` as a runtime environment variable, not as an inline command substitution, so no directory prefix is added. Only `command`-type hooks are supported.

> **Note:** Vibe Code (mistral-vibe) hooks are **experimental** and written to a dedicated `.vibe/hooks.toml` (project) / `~/.vibe/hooks.toml` (global) as a flat `[[hooks]]` TOML array. Each entry carries its own event `type`, a `command`, and optional `name`, `timeout` (seconds, default 60), and `description`. Tool-hook entries (`before_tool` / `after_tool`) additionally carry a tool-name `match` (an fnmatch glob like `bash`/`mcp_*` or a `re:`-prefixed regex, case-insensitive — the canonical `matcher` field; `*` means "any tool") and an optional `strict` flag; `post_agent_turn` carries neither. Three events are supported — `preToolUse` ⇄ `before_tool`, `postToolUse` ⇄ `after_tool`, and `stop` ⇄ `post_agent_turn` (fires after every assistant turn that ends without pending tool calls). Only `command`-type hooks are emitted. Hooks require `enable_experimental_hooks = true` in `.vibe/config.toml`; Rulesync merges this flag into the existing config file (preserving MCP/permissions keys) as an auxiliary file and never deletes `.vibe/config.toml`.

> **Note:** Goose hooks follow the Open Plugins spec: Rulesync writes a plugin directory `hooks/hooks.json` that Goose auto-discovers at startup. Locations are `<project>/.agents/plugins/rulesync/hooks/hooks.json` (project) and `~/.agents/plugins/rulesync/hooks/hooks.json` (global). The JSON shape matches Claude Code's (`{ "hooks": { "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ] } }`). Thirteen lifecycle events are supported — `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `stop` ⇄ `Stop`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `postToolUseFailure` ⇄ `PostToolUseFailure`, `beforeReadFile` ⇄ `BeforeReadFile`, `afterFileEdit` ⇄ `AfterFileEdit`, `beforeShellExecution` ⇄ `BeforeShellExecution`, `afterShellExecution` ⇄ `AfterShellExecution`, `subagentStart` ⇄ `SubagentStart`, and `subagentStop` ⇄ `SubagentStop`. The `matcher` regex is preserved, commands are emitted verbatim (Goose exposes `PLUGIN_ROOT` as a runtime environment variable), and only `command`-type hooks are supported.

> **Note:** Qwen Code hooks are written under the top-level `hooks` key of `.qwen/settings.json` (project) / `~/.qwen/settings.json` (global), using Claude-style PascalCase per-matcher arrays (`{ "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": ... } ] } ] }`). Qwen's supported event set **differs from Gemini CLI's**, so rulesync defines a Qwen-specific mapping. Thirteen lifecycle events are supported — `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `postToolUseFailure` ⇄ `PostToolUseFailure`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `stop` ⇄ `Stop`, `subagentStart` ⇄ `SubagentStart`, `subagentStop` ⇄ `SubagentStop`, `preCompact` ⇄ `PreCompact`, `postCompact` ⇄ `PostCompact`, `permissionRequest` ⇄ `PermissionRequest`, and `notification` ⇄ `Notification`. Qwen-only events (`StopFailure`, `TodoCreated`, `TodoCompleted`) have no canonical equivalent. Commands are emitted verbatim (no `$GEMINI_PROJECT_DIR` rewriting), only `command`-type hooks are supported, and other top-level keys in `settings.json` are preserved on round-trip. See the [Qwen Code hooks docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md).

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
  agent: "agent" # (optional) VS Code prompt-file agent: "ask", "agent", "plan", or a custom agent name (replaces the deprecated "mode")
antigravity: # antigravity specific parameters
  trigger: "/review" # Specific trigger for workflow (renames file to review.md)
  turbo: true # (Optional, default: true) Append // turbo for auto-execution
takt: # takt specific parameters (optional; emitted under .takt/facets/instructions/)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
  extends: "base" # (optional) emit a leading `{extends:<parent>}` facet-inheritance directive (Takt 0.39.0+)
pi: # pi coding agent specific parameters (optional)
  argument-hint: "[message]" # Hint shown in Pi's command palette
codexcli: # Codex CLI custom-prompt specific parameters (optional)
  argument-hint: "[message]" # Hint shown for the custom prompt's arguments
roo: # Roo Code specific parameters (optional)
  mode: "architect" # (optional) mode slug to switch to before running the command body (e.g. "code", "architect")
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

...
```

The command body itself uses a Claude Code-compatible **universal syntax** (e.g. `$ARGUMENTS`, `` !`cmd` ``). When a target tool expects a different placeholder syntax, rulesync translates it automatically on generation and reverses the translation on import. See [Command Syntax](./command-syntax.md) for the full mapping.

> **Qwen Code note:** Custom commands are emitted as **Markdown** files (not TOML — TOML is deprecated upstream) under `.qwen/commands/` (project) and `~/.qwen/commands/` (global, via `--global`). The file is an optional YAML frontmatter block (`description`) followed by the prompt body. Subdirectory namespacing is supported: `.qwen/commands/git/commit.md` becomes the `/git:commit` command. Any extra fields are preserved on round-trip under the `qwencode:` block.

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
  model: inherit # opus, sonnet, haiku, fable, a full model id, or inherit (default)
  tools: ["Read", "Write"] # (optional) allowed tools (string or list)
  disallowedTools: ["Bash"] # (optional) tools to remove (string or list)
  permissionMode: default # (optional) default | acceptEdits | bypassPermissions | plan
  maxTurns: 20 # (optional) maximum agentic turns
  skills: ["skill-creator"] # (optional) Agent Skills to utilize (string or list)
  color: cyan # (optional) UI color (e.g. red, blue, green, cyan, ...)
  memory: project # (optional) user | project | local
  effort: high # (optional) low | medium | high | xhigh | max
  isolation: worktree # (optional) run the subagent in an isolated git worktree
  background: false # (optional) run the subagent in the background
  initialPrompt: "Start by reading the spec." # (optional) seed prompt for the subagent
  mcpServers: {} # (optional) MCP server config (passed through verbatim)
  hooks: {} # (optional) hook config (passed through verbatim)
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
kilo: # for Kilo-specific parameters
  mode: all # (optional, defaults to "all") use "subagent" for hidden/subagent-only agents
cursor: # for Cursor-specific parameters (generated to .cursor/agents/*.md)
  model: inherit # (optional, defaults to "inherit") model id, or "inherit" to use the parent's model
  readonly: false # (optional, defaults to false) restrict the subagent to read-only tools
  is_background: false # (optional, defaults to false) run the subagent as a background agent
junie: # for JetBrains Junie CLI specific parameters (generated to .junie/agents/*.md; also imported from .agents/*.md)
  tools: ["Read", "Grep", "Edit"] # allowed tools
  disallowedTools: ["Bash", "WebSearch"] # disallowed tools
  mcpServers: ["github"] # MCP servers the subagent may use
  model: sonnet # model id
  reasoningLevel: high # low | medium | high
  maxTurns: 20 # max agentic turns
  skills: ["kotlin", "writerside"] # Agent Skills to utilize
  allowPromptArgument: true # whether the subagent accepts a prompt argument
takt: # takt specific parameters (optional; emitted under .takt/facets/personas/)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
roo: # for Roo Code specific parameters (optional; aggregated into the root .roomodes file)
  slug: planner # (optional) custom mode slug (^[a-zA-Z0-9-]+$); defaults to the sanitized file name
  whenToUse: "When planning a task" # (optional) guidance for automated mode selection
  customInstructions: "Be concise." # (optional) extra behavioral guidelines
  roleDefinition: "You are the planner." # (optional) overrides the body as the mode's roleDefinition
  groups: # (optional, defaults to ["read", "edit", "command", "mcp"]) tool access
    - read
    - ["edit", { fileRegex: "\\.md$", description: "Markdown files" }]
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
```

> **Gemini CLI note (as of 2026-04-01):** Subagents are generated to `.gemini/agents/`. To enable the agents feature, set `"experimental": { "enableAgents": true }` in your `.gemini/settings.json`.

> **Qwen Code note:** Subagents are emitted as Markdown + YAML frontmatter under `.qwen/agents/` (project) and `~/.qwen/agents/` (user/global, via `--global`); the body is the subagent's system prompt. Besides the shared `name`/`description`, the `qwencode:` block accepts these optional fields (all preserved on round-trip): `model`, `approvalMode` (`default` | `plan` | `auto-edit` | `yolo` | `bubble`), `tools` (allowlist), `disallowedTools` (denylist), `maxTurns`, `color`, `mcpServers` (per-agent MCP overrides), and `hooks` (per-agent hook registrations). See the [Qwen Code sub-agents docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md).

> **Cline note:** Cline file-based agents are emitted as YAML files (`<name>.yaml`) into `.cline/agents/` (project) and `~/.cline/agents/` (global, via `--global`). The file is a YAML frontmatter block (`name` required, `description`) followed by the system prompt body, matching Cline's agent config loader.

> **Devin note:** Devin Local custom subagent profiles are emitted as `AGENT.md` files in a **directory-per-agent** layout: `.devin/agents/<name>/AGENT.md` (project) and `~/.config/devin/agents/<name>/AGENT.md` (global, via `--global`). The directory name `<name>` is the profile id (derived from the rulesync subagent file name). The `AGENT.md` is a YAML frontmatter block followed by the subagent's system prompt. Besides the shared `name`/`description`, the `devin` subagent block accepts these optional fields (all preserved on round-trip): `model` (string, override the subagent LLM), `allowed-tools` (list of strings, restrict available tools), `permissions` (object with `allow`/`deny`/`ask` string lists, override tool permissions), and `max-nesting` (integer, enable nested subagent spawning up to the given depth). See the [Devin subagents docs](https://docs.devin.ai/cli/subagents).

> **Roo note (as of 2026-06-16):** Roo Code reads project custom modes from a single aggregated `.roomodes` file at the workspace root (YAML; JSON also accepted). Rulesync therefore collapses every Roo-targeted subagent into that file's `customModes` array — each subagent becomes one mode whose `slug` is derived from the file name (sanitized to `^[a-zA-Z0-9-]+$`), `name`/`description` come from the shared frontmatter, and `roleDefinition` is the subagent body. The optional `roo:` block supplies `groups` (defaults to `["read", "edit", "command", "mcp"]`), `whenToUse`, `customInstructions`, an explicit `slug`, and a `roleDefinition` override. (Roo's previous `.roo/subagents/` output was inert — Roo Code never read it.) See the [Roo custom-modes docs](https://roocodeinc.github.io/Roo-Code/features/custom-modes).

> **Kilo note (as of 2026-05-13):** Kilo's documented default for user-defined agents is `mode: all`, which makes the agent available both as a top-level pick and as a subagent. Set `kilo.mode: subagent` to opt into hidden/subagent-only behavior.

Besides `mode`, the `kilo` subagent block accepts these optional fields (all preserved on round-trip):

| Field         | Type             | Notes                                                                            |
| ------------- | ---------------- | -------------------------------------------------------------------------------- |
| `displayName` | string           | Human-friendly name shown in pickers                                             |
| `model`       | string           | Model id                                                                         |
| `variant`     | string           | Model variant                                                                    |
| `temperature` | number           | Sampling temperature                                                             |
| `top_p`       | number           | Nucleus-sampling parameter                                                       |
| `permission`  | string \| object | Permission profile name, or a per-tool `{ <tool>: { allow, deny, ask } }` object |
| `prompt`      | string           | Inline system prompt                                                             |
| `color`       | string           | UI color                                                                         |
| `native`      | boolean          | Native (built-in) agent flag                                                     |
| `hidden`      | boolean          | Hide from top-level picker                                                       |
| `disable`     | boolean          | Disable the agent                                                                |
| `deprecated`  | boolean          | Mark as deprecated                                                               |
| `steps`       | array of object  | Ordered step definitions                                                         |
| `options`     | object           | Free-form key/value options                                                      |

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
  disallowed-tools: # (optional) removes these tools while the skill is active (string or list)
    - "WebFetch"
  disable-model-invocation: true # (optional) disable model invocation for this skill
  scheduled-task: true # (optional) emit to .claude/scheduled-tasks/<name>/SKILL.md instead of .claude/skills/<name>/SKILL.md
  # paths (optional) limits auto-activation to matching globs. Accepts a
  # comma-separated string, e.g. paths: "src/**/*.ts,test/**/*.ts", or a list:
  paths:
    - "src/**/*.ts"
    - "test/**/*.ts"
codexcli: # for codexcli-specific parameters
  short-description: A brief user-facing description
  # The following sections are emitted to the agents/openai.yaml sidecar next to SKILL.md.
  # See https://developers.openai.com/codex/skills.md
  interface: # (optional) UI metadata
    display_name: Example Skill
    short_description: A brief user-facing description
    default_prompt: Do the thing
  policy: # (optional) invocation policy
    allow_implicit_invocation: false # only invoke explicitly via $skill
  dependencies: # (optional) tool dependencies
    tools:
      - type: mcp
        value: example
        description: Example MCP tool
pi: # for Pi Coding Agent-specific parameters (optional)
  allowed-tools:
    - "Bash"
    - "Read"
  disable-model-invocation: true # (optional) disable model invocation for this skill
  license: MIT # (optional)
  compatibility: # (optional) free-form compatibility metadata
    pi-version: ">=0.75.0"
  metadata: # (optional) free-form metadata
    author: rulesync
replit: # for Replit Agent-specific parameters (optional; Agent Skills standard)
  allowed-tools:
    - "Bash"
    - "Read"
  license: MIT # (optional)
  compatibility: # (optional) free-form compatibility metadata
    agent-skills: ">=1.0.0"
  metadata: # (optional) free-form metadata
    author: rulesync
opencode: # for OpenCode-specific parameters (optional)
  license: MIT # (optional)
  compatibility: # (optional) free-form compatibility metadata
    opencode-version: ">=1.16.0"
  metadata: # (optional) free-form metadata
    author: rulesync
  allowed-tools: # (optional) Anthropic-spec passthrough; OpenCode ignores unknown fields
    - "Bash"
    - "Read"
kilo: # for Kilo Code-specific parameters (optional)
  license: MIT # (optional)
  compatibility: # (optional) free-form compatibility metadata
    kilo-version: ">=7.0.0"
  metadata: # (optional) free-form metadata
    author: rulesync
  allowed-tools: # (optional) backward-compat passthrough; not part of Kilo's official SKILL.md frontmatter
    - "Bash"
    - "Read"
agentsskills: # for the Agent Skills standard target (optional; supports project + global ~/.agents/skills/)
  license: MIT # (optional)
  compatibility: "Requires Python 3.14+ and uv" # (optional) free-form string, 1–500 chars (an object is also accepted for back-compat)
  metadata: # (optional) free-form metadata (spec-recommended place for skill versioning)
    version: "1.0.0"
  allowed-tools: "shell" # (optional, experimental) space-separated string or list
copilot: # for GitHub Copilot-specific parameters (optional)
  license: MIT # (optional)
  allowed-tools: "shell" # (optional) tools pre-approved without per-use confirmation
copilotcli: # for GitHub Copilot CLI-specific parameters (optional; project .github/skills/, global ~/.copilot/skills/)
  license: MIT # (optional)
  allowed-tools: "shell" # (optional) tools pre-approved without per-use confirmation
rovodev: # for Rovo Dev CLI-specific parameters (optional; Agent Skills standard)
  allowed-tools: "grep bash" # (optional) space-separated string (a YAML list is also accepted)
  license: MIT # (optional)
  metadata: # (optional) free-form metadata
    author: rulesync
zed: # for Zed-specific parameters (optional)
  disable-model-invocation: true # (optional) prevent the model from auto-invoking this skill
cursor: # for Cursor-specific parameters (optional)
  paths: # (optional) glob patterns (string or list) scoping the skill to matching files
    - "src/**/*.ts"
  disable-model-invocation: true # (optional) only include the skill when invoked via /skill-name
  metadata: # (optional) free-form metadata
    author: rulesync
takt: # takt specific parameters (optional; emitted under .takt/facets/knowledge/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
  extends: "base" # (optional) emit a leading `{extends:<parent>}` facet-inheritance directive (Takt 0.39.0+)
qwencode: # for Qwen Code-specific parameters (optional; project .qwen/skills/, global ~/.qwen/skills/)
  priority: 10 # (optional) higher values appear earlier in /skills listings
  paths: # (optional) glob patterns (string or list) gating model discovery to matching files
    - "src/**/*.ts"
  user-invocable: false # (optional) hide from slash-command invocation, keep model access
  disable-model-invocation: true # (optional) hide from the model but allow direct user invocation
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

> **Note:** `claudecode.disallowed-tools` (a space/comma-separated string or a YAML list) removes the listed tools from the model while the skill is active. The same field is available on Claude Code slash commands. Both round-trip through the `claudecode` frontmatter section.

> **Note:** Codex CLI reads UI metadata, invocation policy, and tool dependencies from an `agents/openai.yaml` sidecar next to `SKILL.md` (Codex's `SKILL.md` frontmatter only carries `name` and `description`). When `codexcli.interface`, `codexcli.policy`, or `codexcli.dependencies` is present, Rulesync emits `.agents/skills/<name>/agents/openai.yaml` and reads it back on import. If the sidecar is emitted and `interface.short_description` is absent, the legacy `codexcli.short-description` is routed there. See the [Codex skills docs](https://developers.openai.com/codex/skills.md).

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

### Transport types (`type` / `transport`)

The `type` (and the equivalent `transport`) field accepts `local`, `stdio`, `sse`, `http`, `ws`, and `streamable-http`. `streamable-http` is the MCP specification's name for the HTTP transport and is accepted as an alias of `http`, so configurations copied from a server's documentation work unchanged. `ws` is the WebSocket transport (a persistent bidirectional connection) and accepts the same `url`/`headers`/`headersHelper`/`timeout` fields as `http`. Tools that do not recognize a given transport keep it on round-trip but may ignore it at runtime.

> **Kilo Code note:** Kilo's MCP config uses its own native shape in `kilo.jsonc` (`type: "local" | "remote"`, `environment`, `enabled`, `command` as an array). Rulesync maps `stdio`/`local` ⇄ Kilo `local` and `http`/`sse` ⇄ Kilo `remote`; on import, Kilo `remote` is normalized to the canonical `http` transport (the deprecated `sse` is no longer emitted). The Kilo-specific `timeout` (local + remote, a positive integer in milliseconds) and `oauth` (remote only — either an OAuth-config object or `false` to disable auto-detection) fields are preserved on round-trip. The `kilo.jsonc` `skills` config key (`skills.paths` for extra skill locations and `skills.urls` for remote skill manifests) is likewise preserved when Rulesync writes the file.

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

> **Qwen Code note:** MCP servers are written to the `mcpServers` key of `.qwen/settings.json` (project) / `~/.qwen/settings.json` (global, via `--global`). Qwen supports stdio (`command`/`args`), SSE (`url`), and HTTP (`httpUrl`) transports. Rulesync maps the canonical per-server `enabledTools` ⇄ Qwen's `includeTools` (allowlist) and `disabledTools` ⇄ Qwen's `excludeTools` (denylist). Other top-level keys in `settings.json` are preserved on round-trip.

### Codex-specific: pass shell env vars to MCP servers (`envVars`)

Codex CLI supports a per-server array of shell env var names to inherit when launching the MCP server process. The source schema uses `envVars` (camelCase, matching the project convention used by sibling fields like `enabledTools`/`disabledTools`); the codex generator renames it to `env_vars` (snake_case) for codex's native `config.toml` format.

This is distinct from `env` (which is a literal `{name: value}` map) — `envVars` is a list of names whose **values come from the user's environment at runtime**. Both fields may coexist on the same server.

```json
{
  "mcpServers": {
    "pal": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/BeehiveInnovations/pal-mcp-server.git",
        "pal-mcp-server"
      ],
      "envVars": ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]
    }
  }
}
```

Generated `~/.codex/config.toml`:

```toml
[mcp_servers.pal]
type = "stdio"
command = "uvx"
args = ["--from", "git+https://github.com/BeehiveInnovations/pal-mcp-server.git", "pal-mcp-server"]
env_vars = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]
```

- Emitted only into the codex CLI output. Stripped from `RulesyncMcp.getMcpServers()` so it does not appear in other tools' generated configs (Claude Code, Kilo, OpenCode, Gemini CLI, Cursor, Cline, Junie, Factorydroid, Rovodev, etc.).
- Use this for secrets and API keys you do not want literal-encoded into a committed `mcp.json`.
- Precedence: codex CLI resolves these names from the user's runtime shell environment. If a name is also set in `env` (literal value), the codex CLI behavior is upstream-defined; see the [Codex configuration reference](https://developers.openai.com/codex/config-reference#mcp_serversid-env_vars) (last checked 2026-05-13) for the exact resolution rule.

> **Grok CLI note:** MCP servers are written to a `[mcp_servers.<name>]` table in `.grok/config.toml` (project) / `~/.grok/config.toml` (global, via `--global`). The file is treated as shared Grok config: Rulesync only replaces the `mcp_servers` key and preserves every other table on round-trip, and it is never deleted. Unlike Codex CLI, Grok uses a literal `env` table (it does not support the `env_vars` runtime-passthrough list) and has no per-server tool allow/deny lists, so the only field rename is `disabled` (rulesync) ⇄ `enabled = false` (grok); an active server simply omits `enabled`. Servers with no environment variables are emitted without a dangling `[mcp_servers.<name>.env]` table (empty nested tables are stripped), and a server whose entire configuration would be empty is dropped with a warning.

### Goose-specific: MCP servers as `extensions` (global only)

Goose configures MCP servers as **extensions** in the shared user config `~/.config/goose/config.yaml`, which is **global only** (Goose has no project-scoped MCP location), so they are generated with `--global`. The schema is non-standard, so Rulesync maps canonical MCP fields to Goose's: `command` → `cmd` (an array `command` folds its tail into `args`), `env` → `envs`, `url`/`httpUrl` → `uri`, and `disabled: true` → `enabled: false`. The `type` is derived — `command` ⇒ `stdio`, a remote `url` ⇒ `streamable_http` (or `sse` when the canonical `type` is `sse`). Each extension also carries its own `name`. Generation merges the `extensions:` block into the existing `config.yaml`, preserving other Goose settings (model, provider, ...), and the file is never deleted. See the [Goose extensions docs](https://block.github.io/goose/docs/getting-started/using-extensions/).

### Goose-specific: commands and subagents as recipes

Goose [recipes](https://block.github.io/goose/docs/guides/recipes/recipe-reference/) are reusable YAML workflow files (`version`, `title`, `description`, plus at least one of `instructions` / `prompt`, and optional `extensions`, `parameters`, `sub_recipes`, …). Rulesync maps:

- **commands → top-level recipes** at `.goose/recipes/<name>.yaml` (project) and `~/.config/goose/recipes/<name>.yaml` (global). The command body becomes the recipe `prompt`.
- **subagents → sub-recipes** at `.goose/recipes/subagents/<name>.yaml` (project) and `~/.config/goose/recipes/subagents/<name>.yaml` (global), referenced from a parent recipe's `sub_recipes` list by relative `path`. The subagent body becomes the recipe `instructions`.

Subagents live in the `subagents/` subdirectory so the command-recipe and subagent-recipe file sets stay disjoint (import and orphan deletion never cross over). `title` defaults to the file name and `description` to the rulesync `description` (falling back to `title`) since recipes require both; `version` defaults to `1.0.0`. Any other recipe field round-trips through the rulesync `goose` section of a command/subagent.

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
`.geminiignore`, `.clineignore`). Antigravity CLI is built on the same engine
as Gemini CLI, so it shares the `.geminiignore` file (enabling either target
writes it). Claude Code is the exception: it does not
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
- `read`: `allow` → `read`, `ask`/`deny` → `deny` in `permissions.<profile>.filesystem`
- `edit` / `write`: `allow` → `write`, `ask`/`deny` → `deny` in `permissions.<profile>.filesystem`
- `webfetch`: `allow`/`deny` map to `permissions.<profile>.network.domains` (Codex does not support `ask` for domain rules); `network.enabled = true` is emitted only when at least one `allow` rule is present. Deny-only domain sets are emitted without `enabled`, which Codex treats as restricted (its default) while the deny entries still round-trip back into Rulesync rules. Codex rejects the global wildcard `*` in denied domains at config load time, so `webfetch: { "*": "deny" }` is skipped with a warning (unlisted domains are denied by Codex's allowlist-first policy anyway); `webfetch: { "*": "allow" }` is emitted as a regular `"*" = "allow"` domain entry, which Codex accepts for denylist-only setups ([openai/codex#15549](https://github.com/openai/codex/pull/15549)). On import, `deny` entries are always taken, while `allow` entries are imported only when `enabled = true` is explicit — Codex treats a missing `enabled` as restricted, so importing an allow entry from a disabled profile would activate a grant Codex never had. A Codex profile with `network.enabled = true` but no `domains` is imported as `webfetch: { "*": "allow" }`, which reflects Codex's default semantics where `enabled = true` grants sandbox-wide network access (under Codex's experimental `network_proxy` feature, `enabled = true` without an allowlist blocks requests instead, and the regenerated `"*" = "allow"` entry is the closest equivalent).

Relative filesystem globs such as `src/**` or `**/*.tf` are emitted under `permissions.<profile>.filesystem.":workspace_roots"` instead of the top-level filesystem table, because Codex expects top-level filesystem keys to be absolute paths, `~/...`, or named roots. Rulesync also sets `glob_scan_max_depth = 8` when generated workspace-root rules contain unbounded `**` patterns.

Codex's built-in `:workspace` baseline grants read access to the whole filesystem and write access to the entire workspace root plus `/tmp` and `$TMPDIR` (with carve-outs protecting `.git`, `.codex`, and `.agents`), and Codex filesystem entries grant access on their own without `extends`. Rulesync therefore emits `extends = ":workspace"` only when a workspace-wide write rule is present (`edit`/`write` with pattern `.`, `./`, `**`, or `./**`); narrowly scoped or workspace-external write rules are expressed purely as `filesystem` entries so the profile never grants more than what the rules ask for. Conversely, a Codex profile that grants write solely via `extends = ":workspace"` is imported as `edit: { ".": "allow" }`, so regeneration converges back to the same `extends` shape instead of dropping the grant.

Rulesync always emits `":minimal" = "read"` in the generated filesystem table. This enables `include_platform_defaults()` ([FileSystemSpecialPath::Minimal](https://github.com/openai/codex/pull/13434)), which provides the platform/runtime read access needed for basic sandboxed command execution on macOS, Linux, and Windows. The special paths `:minimal`, `:root`, `:tmpdir`, and `:slash_tmp` are Codex-native sandbox baselines, not user-managed access rules; Rulesync never imports them into its own permission model and preserves any existing values for `:root`, `:tmpdir`, and `:slash_tmp` verbatim on regeneration.

`network.mode`, `network.unix_sockets`, and `description` have no equivalent in Rulesync's canonical permissions model and are not generated. If an existing `.codex/config.toml` already contains these fields on the `rulesync` profile, Rulesync preserves them on regeneration. Note that `filesystem`, `network.enabled`, `network.domains`, and `extends` are always managed by Rulesync (derived from `edit`/`write`/`webfetch` rules), so hand-authored values in those fields will be replaced on regeneration.

For Gemini CLI, this generates a Policy Engine file at `.gemini/policies/rulesync.toml` (project mode) or `~/.gemini/policies/rulesync.toml` (global mode). Gemini CLI auto-discovers any `*.toml` file under the `policies/` directory, so no `settings.json` modification is required. **Only `--global` output is effective:** Gemini CLI's Policy Engine documents the Workspace tier (project-level `.gemini/policies/`) as **non-functional** — policies placed there have no effect, and only the User tier (`~/.gemini/policies/`, written with `--global`) is honored. Rulesync still emits the project-scope file but logs a warning that it is inert; generate with `--global` for an effective policy.

- `allow` / `deny` / `ask` rules are converted into Policy Engine `decision` values `allow` / `deny` / `ask_user`
- Rule `priority` is assigned per decision so that `deny` (999) beats `ask_user` (500) beats `allow` (1) in the engine's first-match ordering. This matches intuitive allow-with-narrow-deny authoring (e.g. `bash: { "git *": "allow", "git push --force *": "deny" }`) without relying on array order. The values stay within the Policy Engine's documented `0`–`999` per-rule priority range, with `deny` at the top of the band so a hand-authored rule in a sibling `.toml` under `policies/` is unlikely to outrank a rulesync-managed deny by accident.
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

For Factory Droid, this generates `commandAllowlist` / `commandDenylist` arrays in `.factory/settings.json` (project mode) or `~/.factory/settings.json` (global mode). Factory Droid only gates **shell commands** through these two lists, so only the rulesync `bash` category is translated: `allow` patterns become `commandAllowlist` entries (run without confirmation) and `deny` patterns become `commandDenylist` entries (always require confirmation; the denylist wins when a command is in both). Factory Droid has **no separate `ask` list** — any command not in the allowlist already prompts — so rulesync `ask` rules are dropped. Categories other than `bash` cannot be represented in the command allow/deny model and are skipped, with a `logger.warn` when a skipped category carries a `deny` rule (to surface the gap). rulesync owns the `commandAllowlist` / `commandDenylist` keys (they are replaced from the rulesync output), while every other key in `settings.json` (hooks, autonomy settings, etc.) is preserved verbatim on round-trip. Importing reads the two lists back into the `bash` category.

For Cline CLI, this generates `.cline/command-permissions.json` (project mode only). Cline reads this file via the `CLINE_COMMAND_PERMISSIONS` environment variable; you can wire it up with `export CLINE_COMMAND_PERMISSIONS=$(cat .cline/command-permissions.json)`. The schema is `{ "allow": [...], "deny": [...], "allowRedirects": false }`. Cline only supports shell commands and only `allow`/`deny`. Non-`bash` categories are dropped and rulesync `ask` rules for `bash` are **translated to `deny`** (fail-closed safety, since Cline lacks `ask` semantics); both translation notices are surfaced via a single aggregated `logger.warn` per generation (matching the project convention used by every other permissions translator) so the translation stays visible without tripping CI gates that treat error lines as failures. **The `allow` array is wholesale-replaced by rulesync** — user-added entries inside `allow` are not preserved on regenerate. **The `deny` array is additive** — user-added denies in the existing file are preserved on every generation alongside the rulesync-derived denies (fail-closed standard). The `allowRedirects` field is preserved from the existing file (defaults to `false`). Cline does not have a stable per-user file location for command permissions, so global mode is not supported. If a pattern ends up in **both** `allow` and `deny` (defensive check; not reachable from a single rulesync config), Rulesync emits a warning because Cline does not document a deterministic deny-priority.

For Zed, this generates the `agent.tool_permissions` object in `.zed/settings.json` (project mode) or `~/.config/zed/settings.json` (global mode). Each canonical category becomes a key under `agent.tool_permissions.tools.<tool>` (tool-name mapping: `bash` → `terminal`, `read` → `read_file`, `edit` → `edit_file`, `webfetch` → `fetch`, `websearch` → `web_search`; unknown categories, including `mcp:<server>:<tool>` keys, pass through unchanged). Within a category, the catch-all `*` pattern sets the per-tool `default`, while specific patterns become `always_allow` / `always_deny` / `always_confirm` entries of the form `{ "pattern": <regex>, "case_sensitive": false }`. Action mapping: rulesync `ask` ⇄ Zed `confirm` (`allow`/`deny` are shared). Because Zed matches with regular expressions, patterns are emitted verbatim — author canonical patterns as regexes when targeting Zed. The settings file is shared with the MCP (`context_servers`) and ignore (`private_files`) features, so writes merge non-destructively: unrelated settings, the top-level `agent.tool_permissions.default`, and any `tools.<tool>` entries NOT managed by rulesync are preserved on round-trip. The canonical model has no slot for per-pattern case sensitivity, so rulesync always emits `case_sensitive: false`; a hand-authored `case_sensitive: true` on a rulesync-managed tool is overwritten on the next generate.

For Qwen Code, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in `.qwen/settings.json` (project mode) or `~/.qwen/settings.json` (global mode). The format mirrors Claude Code's: entries are `Bash(<pattern>)`, `Read(<pattern>)`, `Edit(<pattern>)`, `Write(<pattern>)`, `WebFetch(<pattern>)`, `WebSearch(<pattern>)`, `Grep(<pattern>)`, `Glob(<pattern>)`, `Agent(<pattern>)`, etc. Other top-level keys in `settings.json` are preserved on round-trip. Patterns may contain nested parentheses (e.g. `Bash(echo (a))`); Rulesync uses the **last** `)` as the closing delimiter when parsing, so inner parens round-trip. Malformed entries (missing closing paren, trailing characters) emit a warning; for **`deny`** they fall back to the catch-all pattern `*` (fail-closed: broadening a deny is the safer direction), but for **`allow` / `ask`** they are **dropped** rather than broadened — silently turning a narrow user rule into `*` would be a fail-open round-trip. Generation does not create the `.qwen/` directory until `writeAiFiles` runs, so dry-run is side-effect-free.

For Warp, this generates the `agent_mode_command_execution_allowlist` / `agent_mode_command_execution_denylist` regex arrays under the `[agents.profiles]` table of Warp's global user `settings.toml` (**global mode only** — Warp has no project-scoped permissions file). The settings file path differs per platform: macOS `~/.warp/settings.toml`, Linux `~/.config/warp-terminal/settings.toml`, Windows `%LOCALAPPDATA%\warp\Warp\config\settings.toml`. Only the `bash` category maps (`allow` → allowlist, `deny` → denylist); Warp matches commands with **regular expressions**, so patterns are emitted verbatim — author canonical `bash` patterns as regexes when targeting Warp (mirrors Zed). Warp has no per-command `ask` list, so `ask` rules are dropped, and non-`bash` categories are skipped (with a warning when they carry `deny` rules). On import, a pattern present in both lists resolves to `deny` (Warp's denylist wins). The `[agents.profiles]` block is merged into the existing `settings.toml`, preserving other Warp settings, and the file is never deleted. **rulesync owns the two command lists** (it is the source of truth): the `allowlist`/`denylist` are replaced from the rulesync config on each `--global` generate, so a manually curated Warp allowlist/denylist not mirrored in `.rulesync/permissions.json` is overwritten — keep command permissions in rulesync. MCP allow/deny and file-read permissions are separate Warp surfaces not modeled here. See the [Warp agent profiles & permissions docs](https://docs.warp.dev/agent-platform/capabilities/agent-profiles-permissions/).

For the Antigravity IDE, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in the committable workspace `.antigravity/settings.json` (**project mode only**). Antigravity 2.0 evaluates these `Deny > Ask > Allow` and uses `action(target)` entries; rulesync maps canonical categories onto the IDE action vocabulary: `read` → `read_file`, `edit`/`write` → `write_file`, `bash` → `command`, `webfetch`/`websearch` → `read_url`, `mcp` → `mcp` (the IDE-only `execute_url` / `unsandboxed` actions have no canonical equivalent and pass through verbatim). Because `edit`/`write` collapse to `write_file` and `webfetch`/`websearch` collapse to `read_url`, importing normalizes back to `write` / `webfetch` (a documented, lossy mapping). The `settings.json` file holds other workspace settings, so the `permissions` block is merged in place — entries for unmanaged actions are preserved — and the file is never deleted. The User-scope settings file is a platform-dependent VS-Code-style path outside rulesync's home-relative global model, so **global mode is not supported**; the workspace file is intended to be checked into git. See the [Antigravity permissions docs](https://antigravity.google/docs/permissions).

For Rovo Dev CLI, this generates the `toolPermissions` block of the global `~/.rovodev/config.yml` (**global mode only** — Rovo Dev has no project-scoped permissions file, mirroring the Rovodev MCP adapter). Rovo Dev's three levels (`allow`/`ask`/`deny`) are an exact 1:1 with rulesync's canonical actions, so action values pass through verbatim. The `bash` category maps the catch-all `*` pattern to `bash.default` and every other pattern to a `bash.commands[]` entry `{ command: <pattern as regex>, permission }` (Rovo Dev matches commands as regexes, so author `bash` patterns accordingly). The `read` category maps to the inspection tools (`open_files`, `expand_code_chunks`, `expand_folder`, `grep`) and `edit`/`write` to the mutation tools (`find_and_replace_code`, `create_file`, `delete_file`, `move_file`); because these per-tool keys hold a single level (no per-pattern rules), only the catch-all `*` of each category sets the level. Because `edit` and `write` both map onto the same mutation tools, a conflicting catch-all between them cannot be represented; `edit` takes precedence and a warning is logged. Non-catch-all `allow` paths in those categories are surfaced as `allowedExternalPaths` so explicit grants are not dropped; non-`allow` non-catch-all rules cannot be expressed per-path and are skipped with a warning. Categories without a clean Rovo Dev target (e.g. `webfetch`) are skipped with a warning. `config.yml` holds all of Rovo Dev's settings (`agent`, `sessions`, `mcp`, etc.), so the `toolPermissions` block is merged in place — every other top-level key (and any unmanaged keys inside `toolPermissions`) is preserved (values only — YAML comments and formatting in the existing file are not retained on rewrite) — and the file is never deleted. See the [Rovo Dev CLI settings](https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings/) and [tool permissions](https://support.atlassian.com/rovo/docs/use-tools-in-rovo-dev-cli/) docs.

> **Note: Interaction with ignore feature.** Both the ignore feature and the permissions feature can manage `Read` tool deny entries in `.claude/settings.json`. When both features configure the `Read` tool, the **permissions feature takes precedence** and a warning is emitted. If you only need to restrict file reads based on glob patterns, use the ignore feature (`.rulesync/.aiignore`). Use permissions only when you need fine-grained `allow`/`ask`/`deny` control over the `Read` tool.
