# File Formats

## Symlinks

Rulesync follows symbolic links when it discovers source files, whether you use a plain `.rulesync/` directory or a separate `--input-root`. Glob-based discovery (rules, commands, subagents, skills) follows symlinked files and directories; single fixed-path files such as `.rulesyncignore`, `.rulesync/mcp.jsonc`, and `.rulesync/permissions.jsonc` are likewise resolved transparently by the OS when read. A symlink inside the input tree that points elsewhere is followed transparently, and the resolved file content is copied into the generated output. This is intentional: it lets you centralize shared skills or rules in one place and reference them via symlinks without duplication (see [issue #1707](https://github.com/dyoshikawa/rulesync/issues/1707)).

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
  inclusion: "fileMatch" # always, fileMatch, manual, or auto
  fileMatchPattern: ["src/components/**/*.tsx"] # (optional) glob string or array of globs, used when inclusion is "fileMatch"
  name: "api-design" # (optional) required when inclusion is "auto"; the steering entry key
  description: "REST API design patterns. Use when creating or modifying API endpoints." # (optional) required when inclusion is "auto"; Kiro auto-includes the file when a request matches this
takt: # takt specific parameters (optional; emitted under .takt/facets/policies/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
  extends: "base" # (optional) emit a leading `{extends:<parent>}` facet-inheritance directive (Takt 0.39.0+)
  facet: "output-contracts" # (optional) "policies" (default) or "output-contracts": redirect this rule to Takt's output-structure/report-template facet
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

...
```

> **Kiro note:** Kiro reads steering files from `.kiro/steering/*.md` and uses an `inclusion` frontmatter block to decide when each is loaded (`always`, `fileMatch` with a `fileMatchPattern`, `manual`, or `auto` — which auto-includes the file when a request matches its companion `description`, keyed by `name`). Rulesync derives this for non-root steering files: an explicit `kiro.inclusion` block round-trips as-is (carrying `name`/`description` through for `auto`); otherwise specific (non-wildcard) `globs` map to `inclusion: fileMatch` (a single glob is written as a string and multiple as a YAML array, both of which Kiro accepts), so the rule applies only to matching files instead of always; otherwise the file stays always-on and is written without a frontmatter block (Kiro's no-frontmatter default). The root overview index is always written plain so Kiro always loads it. In **global** mode (`--global`), steering is written to `~/.kiro/steering/` with the root rule as `~/.kiro/steering/product.md` (Kiro does not read `~/AGENTS.md`, so the project-scope root `AGENTS.md` is not used at the home level), and global MCP is written to `~/.kiro/settings/mcp.json`.

> **Kilo Code note:** Kilo writes the root rule to the auto-loaded `AGENTS.md` and non-root rules to `.kilo/rules/*.md`. Because Kilo v7 does not auto-load files under `.kilo/rules/`, Rulesync also registers each generated non-root rule file in the `instructions` array of the shared `kilo.jsonc` (the root `AGENTS.md` is auto-loaded and is therefore not registered). This merge is non-destructive: existing keys such as `mcp`, `tools`, and `permission` are preserved, and the `instructions` list is deduped and sorted.

> **Kimi Code note:** Kimi Code reads `.kimi-code/AGENTS.md` at project scope and `~/.kimi-code/AGENTS.md` at user scope. When `KIMI_CODE_HOME` is set, Rulesync follows Kimi and resolves every global Kimi-specific file (`AGENTS.md`, `mcp.json`, `config.toml`, `skills/`, and `agents/`) under that custom data root; the shared `~/.agents/skills/` and `~/.agents/agents/` discovery roots remain under the user's real home directory. Because Kimi has no dedicated directory for topic-based instruction files, Rulesync folds every non-root rule body into that single file. See the [Kimi Code agents and instruction-files docs](https://moonshotai.github.io/kimi-code/en/customization/agents.html) and [environment-variable docs](https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html).

> **OpenCode note:** OpenCode writes the root rule to the auto-loaded `AGENTS.md` and non-root rules to `.opencode/memories/*.md`. Because OpenCode auto-loads only the root `AGENTS.md` plus files explicitly listed in the `instructions` array of `opencode.json` (it does not auto-discover a rules directory), Rulesync also registers each generated non-root rule file in the `instructions` array of the shared `opencode.json`/`opencode.jsonc` (the root `AGENTS.md` is auto-loaded and is therefore not registered). This merge is non-destructive: existing keys such as `mcp`, `tools`, and `permission` are preserved, and the `instructions` list is deduped and sorted.

> **Qwen Code note:** Qwen Code writes the root rule to the auto-loaded `QWEN.md` (project) / `~/.qwen/QWEN.md` (global, via `--global`) as plain Markdown, and non-root rules to its path-based context-rule directory `.qwen/rules/` (project) / `~/.qwen/rules/` (global). Each non-root rule is a Markdown file with optional YAML frontmatter: Rulesync maps `globs` ⇄ Qwen's `paths` (a picomatch glob array) and `description` ⇄ `description`. A rule **with** specific `paths` is _conditional_ — Qwen lazily injects it only when the model touches a matching file — while a rule **without** `paths` (empty or wildcard `**/*`/`*` globs) is a _baseline_ rule loaded at session start and is written as plain Markdown with no frontmatter block. The `.qwen/rules/` directory supersedes the legacy `.qwen/memories/` import surface, so each rule is emitted to exactly one location; the root `QWEN.md` is unchanged. See the [Qwen Code memory/context docs](https://github.com/QwenLM/qwen-code).

> **Cline note:** Cline writes the root rule to the auto-loaded `AGENTS.md` (project) as plain Markdown, and non-root rules to its flat `.clinerules/` directory. Each non-root rule is a Markdown file with optional YAML frontmatter for conditional activation: Rulesync maps `globs` ⇄ Cline's `paths` (a glob array; the rule loads only when a matching file is in context) and `description` ⇄ `description`. A rule with **specific** `globs` emits `paths`; a rule with **universal** globs (`**/*` or `*`) emits `alwaysApply: true` (always load); a rule **without** globs is written as plain Markdown with no frontmatter block (always active). In global mode (via `--global`), Cline rules are written to the cross-tool `~/.agents/AGENTS.md` (Cline CLI v3.0.15+) as plain Markdown. See the [Cline rules docs](https://docs.cline.bot/customization/cline-rules).

> **Pi note:** Pi writes the root rule to the auto-loaded `AGENTS.md` (project) / `~/.pi/agent/AGENTS.md` (global, via `--global`) as plain Markdown, and folds non-root rules into that single file (Pi has no modular rules directory). Pi additionally loads two system-prompt instruction files. `.pi/APPEND_SYSTEM.md` (project) / `~/.pi/agent/APPEND_SYSTEM.md` (global) **appends** to the default system prompt, and Rulesync emits it from any rule that opts in via a `pi.systemPrompt: append` frontmatter block — those rule bodies are routed to `APPEND_SYSTEM.md` instead of `AGENTS.md`, multiple opted-in rules concatenate in source order, and the file is managed by generate/import/delete like the root file (note: if you hand-authored `.pi/APPEND_SYSTEM.md` before this feature existed, `generate --delete` for the `pi` target now treats it as a managed path and removes it unless a rule opts in — import it first to convert it into a canonical rule). The opt-in is ignored on the `root: true` rule, which always stays on `AGENTS.md` (routing the root away would leave the context file without a merge target). `.pi/SYSTEM.md` (project) / `~/.pi/agent/SYSTEM.md` (global) **replaces** the default system prompt entirely — which silently disables Pi's built-in tool instructions — so Rulesync deliberately never emits it and leaves it to be authored by hand. Example:
>
> ```yaml
> ---
> targets: ["pi"]
> description: "House style for the system prompt"
> pi:
>   systemPrompt: append # routes this rule's body to .pi/APPEND_SYSTEM.md / ~/.pi/agent/APPEND_SYSTEM.md
> ---
> ```
>
> See the [Pi usage docs](https://pi.dev/docs/latest/usage).

> **Junie note:** Junie CLI resolves project guidelines **first-match-wins** — `.junie/AGENTS.md` → root `AGENTS.md` → the legacy `.junie/guidelines.md` / `.junie/guidelines/` — and documents no file-inclusion mechanism, so Rulesync writes the root rule to `.junie/AGENTS.md` (project) / `~/.junie/AGENTS.md` (global, via `--global`) and folds non-root rules into that single file. The legacy `.junie/guidelines.md` is still accepted as an import fallback. Earlier Rulesync versions emitted non-root rules to `.junie/memories/*.md`, which is not a documented Junie read path; those files are no longer generated (stale outputs stay gitignored but are not cleaned up automatically). See the [Junie guidelines docs](https://junie.jetbrains.com/docs/guidelines-and-memory.html).

> **Reasonix note:** Reasonix auto-injects a hierarchical instruction document, reading its vendor-specific `REASONIX.md` (alongside the cross-tool `AGENTS.md`/`CLAUDE.md`) by walking user-home → ancestors → project root/local. Rulesync writes the vendor `REASONIX.md` at the project root (project) / `~/.reasonix/REASONIX.md` (global, via `--global`) and folds non-root rules into that single file, since Reasonix has no modular rules directory. See the [Reasonix GUIDE](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md).

## `.rulesync/hooks.jsonc`

`.rulesync/hooks.jsonc` is the recommended source path and accepts comments and trailing commas. The legacy `.rulesync/hooks.json` path remains readable for existing projects. When both files exist, the JSONC file takes precedence; write flows update the existing source instead of creating a second variant.

Hooks run scripts at lifecycle events (e.g. session start, before tool use). Events use **canonical camelCase** in this file, and Rulesync translates them per tool: Cursor uses them as-is; Claude Code, Factory Droid, Codex CLI, Gemini CLI, and Goose get PascalCase (with a few tool-specific name mappings) in their settings files; OpenCode and Kilo hooks are emitted as JavaScript plugins (`.opencode/plugins/rulesync-hooks.js`, `.kilo/plugins/rulesync-hooks.js`); Amp hooks are emitted as a TypeScript plugin (`.amp/plugins/rulesync-hooks.ts`, or `~/.config/amp/plugins/rulesync-hooks.ts` in global mode) using `session.start`, `tool.call`, `tool.result`, `agent.start`, and `agent.end`; Pi Coding Agent hooks are emitted as a Rulesync-owned TypeScript extension (`.pi/extensions/rulesync-hooks.ts`, or `~/.pi/agent/extensions/rulesync-hooks.ts` in global mode) that subscribes to Pi's snake_case extension events (`sessionStart` → `session_start`, `stop` → `agent_end`, `preToolUse` → `tool_call` with the matcher tested as a regex against the tool name) and observes events only — command hooks run but cannot block or mutate Pi events; Copilot and Copilot CLI map event names to their own camelCase (e.g. `beforeSubmitPrompt` → `userPromptSubmitted`, `stop` → `agentStop`, `afterError` → `errorOccurred`) and use `powershell`/`bash` command fields — Copilot CLI additionally covers a wider event set and supports `prompt` and `http` hook types beyond `command`; deepagents-cli uses a dot-notation (e.g. `session.start`, `tool.error`); Kiro emits hooks into `.kiro/agents/default.json` using Kiro's CLI event names (`agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`); Qwen Code emits PascalCase events into the `hooks` key of `.qwen/settings.json` (its supported event set differs from Gemini CLI's).

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
  }
}
```

**Top-level keys:**

- `version`: Schema version (currently `1`).
- `hooks`: Map of canonical event names to an array of hook entries. These are dispatched to every tool that supports the given event.
- `amp.hooks`, `cursor.hooks`, `claudecode.hooks`, `opencode.hooks`, `kilo.hooks`, `copilot.hooks`, `copilotcli.hooks`, `factorydroid.hooks`, `codexcli.hooks`, `goose.hooks`, `deepagents.hooks`, `kiro.hooks`, `kiro-ide.hooks`, `qwencode.hooks`, `grokcli.hooks`: Tool-specific **override keys**. Entries under these keys are emitted only for the corresponding tool, so tool-only events (e.g. `afterFileEdit` for Cursor/OpenCode/Kilo, `worktreeCreate` for Claude Code, `afterError` for Copilot/Copilot CLI, `PostFileSave`/`PreTaskExec` for Kiro IDE) can coexist with shared ones without leaking to other tools. `copilotcli.hooks` falls back to `copilot.hooks`, which in turn falls back to the shared `hooks` block.

**Hook entry keys:**

- `command` (required): Shell command to execute when the event fires.
- `type` (optional): One of `"command"` (default), `"prompt"`, `"http"`, `"agent"`, `"mcp_tool"`, or `"function"` — the union of the hook types accepted across supported tools. Each tool supports a subset (most support only `command`); hooks with a type a tool does not support are skipped for that tool with a warning. See notes below.
- `matcher` (optional): Regex used by tools that scope hooks to specific tool names (e.g. `preToolUse`, `postToolUse`, `notification`). Ignored by events that do not take a matcher (e.g. `sessionStart`, `worktreeCreate`, `worktreeRemove`).
- `timeout` (optional): Per-hook timeout in seconds, forwarded to tools that support it.
- `failClosed` (optional): Boolean. When `true`, a hook failure (crash, timeout, invalid JSON) blocks the action instead of allowing it through. Passed through to Cursor's `.cursor/hooks.json` and to JetBrains Junie's `~/.junie/config.json` (as Junie's equivalently-named `blockOnError` flag).
- `async` (optional): Boolean. When `true`, the hook command runs in the background without blocking. Forwarded to Qwen Code (`.qwen/settings.json`) and JetBrains Junie (`~/.junie/config.json`, same field name).
- `shell` (optional): Either `"bash"` or `"powershell"` — the only two interpreter values any tool accepts. Forwarded to Qwen Code command hooks.
- `url` / `headers` / `allowedEnvVars` (optional, `http` hooks): the POST target URL, request headers (values support `$VAR` interpolation), and the env-var allowlist for that interpolation. Forwarded to Claude Code and Qwen Code http hooks.
- `server` / `tool` / `input` (optional, `mcp_tool` hooks): the configured MCP server name, the tool to call on it, and the (arbitrary JSON) arguments, whose string values support `${path}` substitution from the hook input. Forwarded to Claude Code mcp_tool hooks.
- `model` (optional, `prompt` / `agent` hooks): the model used for evaluation (defaults to a fast model). Forwarded to Claude Code prompt/agent hooks.
- `if` (optional): a single permission rule (same syntax as `settings.json` permission rules, e.g. `"Bash(rm *)"`) that filters a hook by tool arguments in addition to the tool name. Forwarded to Claude Code, where it is evaluated only on tool events (`preToolUse`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `permissionDenied`); it round-trips as an opaque string.

Top-level `hooks` keys must be canonical event names; unknown event names are rejected at parse time. Tool-specific override blocks (e.g. `kiro-ide.hooks`) additionally accept tool-native event keys, which pass through verbatim.

Events present in the shared `hooks` block but unsupported by a given tool are skipped for that tool (a warning is logged at generate time). The canonical `notification` event maps to deepagents-cli's `input.required` (human-in-the-loop interrupt).

### Hook event × tool matrix

| Event                  | Cursor | Claude Code | OpenCode | Kilo | Copilot | Copilot CLI | Factory Droid | Gemini CLI | Codex CLI | deepagents | Kiro | Antigravity IDE | Antigravity CLI | Devin | AugmentCode | Goose |
| ---------------------- | :----: | :---------: | :------: | :--: | :-----: | :---------: | :-----------: | :--------: | :-------: | :--------: | :--: | :-------------: | :-------------: | :---: | :---------: | :---: |
| `sessionStart`         |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |        —        |        —        |   —   |     ✅      |  ✅   |
| `sessionEnd`           |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |     —     |     ✅     |  ✅  |        —        |        —        |   —   |     ✅      |  ✅   |
| `beforeSubmitPrompt`   |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |        —        |        —        |  ✅   |      —      |  ✅   |
| `preToolUse`           |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `postToolUse`          |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `preModelInvocation`   |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |       ✅        |       ✅        |   —   |      —      |   —   |
| `postModelInvocation`  |   —    |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |       ✅        |       ✅        |   —   |      —      |   —   |
| `postToolUseFailure`   |   ✅   |     ✅      |    —     |  —   |    —    |     ✅      |       —       |     —      |     —     |     ✅     |  —   |        —        |        —        |   —   |      —      |  ✅   |
| `stop`                 |   ✅   |     ✅      |    ✅    |  ✅  |   ✅    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  ✅  |       ✅        |       ✅        |   —   |     ✅      |  ✅   |
| `subagentStart`        |   ✅   |     ✅      |    —     |  —   |    —    |     ✅      |       —       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `subagentStop`         |   ✅   |     ✅      |    —     |  —   |   ✅    |     ✅      |      ✅       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `preCompact`           |   ✅   |     ✅      |    —     |  —   |    —    |     ✅      |      ✅       |     ✅     |    ✅     |     ✅     |  —   |        —        |        —        |   —   |      —      |   —   |
| `postCompact`          |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |    ✅     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `afterFileEdit`        |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `beforeShellExecution` |   ✅   |      —      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `afterShellExecution`  |   ✅   |      —      |    ✅    |  ✅  |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |  ✅   |
| `beforeMCPExecution`   |   ✅   |      —      |    —     |  —   |    —    |     ✅      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |  ✅   |      —      |   —   |
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
| `instructionsLoaded`   |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `userPromptExpansion`  |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `postToolBatch`        |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `permissionDenied`     |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `taskCreated`          |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `taskCompleted`        |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `stopFailure`          |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `teammateIdle`         |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `configChange`         |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `cwdChanged`           |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `fileChanged`          |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `elicitation`          |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |
| `elicitationResult`    |   —    |     ✅      |    —     |  —   |    —    |      —      |       —       |     —      |     —     |     —      |  —   |        —        |        —        |   —   |      —      |   —   |

> **Note:** `worktreeCreate`, `worktreeRemove`, `messageDisplay`, `postToolBatch`, `taskCreated`, `taskCompleted`, `teammateIdle`, and `cwdChanged` are Claude Code events that do not support the `matcher` field (they fire on every occurrence). Any matcher defined in the config is ignored for these events.

> **Note:** Rulesync implements OpenCode hooks as a plugin at `.opencode/plugins/rulesync-hooks.js` and Kilo hooks as a plugin at `.kilo/plugins/rulesync-hooks.js`, so importing from OpenCode/Kilo to rulesync is not supported. Both only support command-type hooks (not prompt-type).

> **Note:** Rulesync implements Amp hooks as a generated TypeScript plugin at `.amp/plugins/rulesync-hooks.ts` (project) or `~/.config/amp/plugins/rulesync-hooks.ts` (global), so importing arbitrary Amp plugin code is not supported. Amp supports command hooks for `sessionStart` → `session.start`, `preToolUse` → `tool.call`, `postToolUse` → `tool.result`, `beforeSubmitPrompt` → `agent.start`, and `stop` → `agent.end`. Tool-event matchers are regular expressions against the Amp tool name; definitions with a matcher on any lifecycle event are skipped with a warning. A failing `preToolUse` command rejects the tool call and lets the agent continue; other mapped events observe the command result.

> **Amp command syntax:** Amp executes plugin commands with [Bun Shell](https://bun.com/docs/runtime/shell), whose syntax differs slightly from POSIX shells. Use `$VAR` for environment expansion (`${VAR}` remains literal) and `$(command)` for command substitution (backticks remain literal). Rulesync passes the authored command through unchanged so quoting and escaped operators retain their Bun Shell meaning.

> **Note:** GitHub Copilot's format uses separate `powershell` and `bash` fields for hooks. Rulesync supports only a single `command` field and resolves this by emitting the command under the `powershell` key on Windows, and under the `bash` key on all other platforms.

> **Note:** Hook file paths per tool:
>
> - **Copilot (cloud agent)** — `<project>/.github/hooks/copilot-hooks.json`.
> - **Copilot CLI** — project: `<project>/.github/hooks/copilotcli-hooks.json`; global: `~/.copilot/hooks/copilot-hooks.json`. The Copilot CLI docs let you choose any filename inside `.github/hooks/`, so Rulesync uses the CLI-specific name to avoid colliding with the cloud-agent file when both targets are enabled. The global path is a Rulesync convention; the official Copilot CLI documentation does not currently enumerate a global hooks location, so this placement may change if the spec later mandates an alternate layout. Copilot CLI uses a **wider event surface** than the shared cloud-agent set (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `agentStop` ← `stop`, `subagentStart`, `subagentStop`, `errorOccurred` ← `afterError`, `preCompact`, `permissionRequest`, `notification`, `preMcpToolCall` ← `beforeMCPExecution`) and supports three hook types: **`command`** (`bash`/`powershell` with optional `timeoutSec`, plus pass-through `cwd`/`env`), **`prompt`** (a `prompt` string — Copilot CLI only honors prompt hooks on `sessionStart`, so prompt hooks on other events are dropped), and **`http`** (`url`/`headers`/`allowedEnvVars` with optional `timeoutSec`). On `preToolUse` / `postToolUse`, an entry's optional `matcher` field (a regex compiled as `^(?:PATTERN)$`, tested against the tool name) is emitted and round-tripped; on any other event a matcher is dropped (with a warning) because the CLI does not honor it there ([changelog v1.0.36, 2026-04-24](https://github.com/github/copilot-cli) and [v1.0.63, 2026-06-15](https://github.com/github/copilot-cli)).
> - **Antigravity IDE / Antigravity CLI** — project: `<project>/.agents/hooks.json`; global: `~/.gemini/config/hooks.json`. Both targets share the same dedicated `hooks.json` (a Claude-Code-style matcher map nested under a generated `rulesync` hook name), so enabling both writes the same file.
> - **Devin Desktop (formerly Windsurf)** — project: `<project>/.windsurf/hooks.json`; global: `~/.codeium/windsurf/hooks.json`. The Cascade Hooks file location is unchanged by the Devin Desktop rebrand.
> - **AugmentCode** — project: `<project>/.augment/settings.json`; global: `~/.augment/settings.json`. Hooks are merged under the top-level `hooks` key of the shared settings file (which also holds `toolPermissions`).
> - **Kimi Code** — global only: `~/.kimi-code/config.toml`. Hooks are merged into the shared `[[hooks]]` array without replacing unrelated model, provider, or permission settings.
> - **Vibe Code** — project: `<project>/.vibe/hooks.toml`; global: `~/.vibe/hooks.toml`. Hooks are **experimental** and require `enable_experimental_hooks = true` in `.vibe/config.toml` (or `VIBE_ENABLE_EXPERIMENTAL_HOOKS=true`); Rulesync merges this flag into the shared `.vibe/config.toml` without clobbering existing MCP/permissions settings.

> **Note:** Because each AI tool evolves its own hook surface at its own pace, the matrix above reflects the events Rulesync currently translates. When a tool ships a new event that Rulesync does not yet support, the most reliable path is to open an issue — the matrix is the intended baseline to compare against.

> **Note:** Kiro hooks are emitted into `.kiro/agents/default.json` under the `hooks` field, merging with any existing agent configuration (tools, allowedTools, etc.). Both `sessionEnd` and `stop` canonical events map to Kiro CLI's `stop` event. Only `command`-type hooks are supported; `prompt`-type hooks are silently skipped. Kiro CLI uses `timeout_ms` (in milliseconds) for per-hook timeouts.

> **Note:** Antigravity (IDE and CLI) writes a dedicated `hooks.json` keyed by a **named hook** whose value holds the event map, e.g. `{ "rulesync": { "PreToolUse": [ { "matcher": "...", "hooks": [...] } ], "Stop": [ { "hooks": [...] } ] } }`. Rulesync emits a single generated hook under the stable name `rulesync`. It supports five lifecycle events — `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `preModelInvocation` ⇄ `PreInvocation`, `postModelInvocation` ⇄ `PostInvocation`, and `stop` ⇄ `Stop` — where `PreInvocation`/`PostInvocation`/`Stop` are matcher-less handler lists. On import, both the named-hook wrapper and a legacy flat top-level event map are accepted, and the optional per-hook `enabled` flag is ignored.

> **Note:** Devin Desktop (formerly Windsurf) Cascade Hooks (GA) are written to a dedicated `hooks.json` whose top-level `hooks` key maps each Cascade event name to a **flat array** of hook objects (no `matcher`, no `type`, no inner `hooks` wrapper, and no `timeout`). Each object carries `command` and/or `powershell`, plus optional `show_output` and `working_directory`. Rulesync splits the generic tool lifecycle into Devin's file/command/MCP-specific events, so the canonical events map bijectively: `beforeReadFile` ⇄ `pre_read_code`, `beforeTabFileRead` ⇄ `post_read_code`, `afterTabFileEdit` ⇄ `pre_write_code`, `afterFileEdit` ⇄ `post_write_code`, `beforeShellExecution` ⇄ `pre_run_command`, `afterShellExecution` ⇄ `post_run_command`, `beforeMCPExecution` ⇄ `pre_mcp_tool_use`, `afterMCPExecution` ⇄ `post_mcp_tool_use`, `beforeSubmitPrompt` ⇄ `pre_user_prompt`, `afterAgentResponse` ⇄ `post_cascade_response`, `beforeAgentResponse` ⇄ `post_cascade_response_with_transcript`, and `worktreeCreate` ⇄ `post_setup_worktree`. Canonical events with no Devin equivalent (e.g. `sessionStart`, `stop`) are dropped with a logged warning. The Cascade Hooks file location (`.windsurf/hooks.json` / `~/.codeium/windsurf/hooks.json`) is retained from the Windsurf era and is unaffected by the rebrand.

> **Note:** AugmentCode (Auggie CLI) hooks are merged under the top-level `hooks` key of the shared `.augment/settings.json` (project) / `~/.augment/settings.json` (global), mirroring Claude Code's per-event matcher arrays (`{ "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": ... } ] } ] }`). The `hooks` block is merged in place so it coexists with the `toolPermissions` block from the permissions feature. Six lifecycle events are supported — `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `stop` ⇄ `Stop`, and `notification` ⇄ `Notification`. The `matcher` field (a case-sensitive regex, default `.*`, with `mcp:*` support) applies only to the tool events `PreToolUse`/`PostToolUse`; any matcher on the session events (including `Notification`) is dropped with a logged warning. Commands are emitted verbatim — Auggie exposes `AUGMENT_PROJECT_DIR` as a runtime environment variable, not as an inline command substitution, so no directory prefix is added. Only `command`-type hooks are supported. On **import** (project scope), Rulesync also reads the layered overrides file `<workspace>/.augment/settings.local.json` — a gitignored, machine-specific file that Auggie merges on top of `settings.json` — and combines it over the base settings before importing, following Auggie's documented layering (simple values take the local override, `mcpServers`/`plugins` replace wholesale, and other objects/lists — including the `hooks` events — are combined across tiers), so personal hook overrides are picked up without dropping base events. This overlay is **import-only and project-only**: Rulesync never writes `settings.local.json`, AugmentCode documents no global `~/.augment/settings.local.json`, so the overlay is skipped in global mode.

> **Note:** Vibe Code (mistral-vibe) hooks are **experimental** and written to a dedicated `.vibe/hooks.toml` (project) / `~/.vibe/hooks.toml` (global) as a flat `[[hooks]]` TOML array. Each entry carries its own event `type`, a `command`, and optional `name`, `timeout` (seconds, default 60), and `description`. Tool-hook entries (`before_tool` / `after_tool`) additionally carry a tool-name `match` (an fnmatch glob like `bash`/`mcp_*` or a `re:`-prefixed regex, case-insensitive — the canonical `matcher` field; `*` means "any tool") and an optional `strict` flag; `post_agent_turn` carries neither. Three events are supported — `preToolUse` ⇄ `before_tool`, `postToolUse` ⇄ `after_tool`, and `stop` ⇄ `post_agent_turn` (fires after every assistant turn that ends without pending tool calls). Only `command`-type hooks are emitted. Hooks require `enable_experimental_hooks = true` in `.vibe/config.toml`; Rulesync merges this flag into the existing config file (preserving MCP/permissions keys) as an auxiliary file and never deletes `.vibe/config.toml`.

> **Note:** Goose hooks follow the Open Plugins spec: Rulesync writes a plugin directory `hooks/hooks.json` that Goose auto-discovers at startup. Locations are `<project>/.agents/plugins/rulesync/hooks/hooks.json` (project) and `~/.agents/plugins/rulesync/hooks/hooks.json` (global). The JSON shape matches Claude Code's (`{ "hooks": { "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ] } }`). Eleven lifecycle events are supported — `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `stop` ⇄ `Stop`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `postToolUseFailure` ⇄ `PostToolUseFailure`, `beforeReadFile` ⇄ `BeforeReadFile`, `afterFileEdit` ⇄ `AfterFileEdit`, `beforeShellExecution` ⇄ `BeforeShellExecution`, and `afterShellExecution` ⇄ `AfterShellExecution` — matching Goose's `HookEvent` enum exactly (it has no `SubagentStart`/`SubagentStop`). The `matcher` regex is preserved, commands are emitted verbatim (Goose exposes `PLUGIN_ROOT` as a runtime environment variable), and only `command`-type hooks are supported.

> **Note:** Qwen Code hooks are written under the top-level `hooks` key of `.qwen/settings.json` (project) / `~/.qwen/settings.json` (global), using Claude-style PascalCase per-matcher arrays (`{ "EventName": [ { "matcher": "...", "sequential": false, "hooks": [ { "type": "command", "command": "...", "timeout": ... } ] } ] }`). Qwen's supported event set **differs from Gemini CLI's**, so rulesync defines a Qwen-specific mapping. Twenty lifecycle events are supported — `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `postToolUseFailure` ⇄ `PostToolUseFailure`, `postToolBatch` ⇄ `PostToolBatch`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `userPromptExpansion` ⇄ `UserPromptExpansion`, `stop` ⇄ `Stop`, `stopFailure` ⇄ `StopFailure`, `subagentStart` ⇄ `SubagentStart`, `subagentStop` ⇄ `SubagentStop`, `preCompact` ⇄ `PreCompact`, `postCompact` ⇄ `PostCompact`, `permissionRequest` ⇄ `PermissionRequest`, `permissionDenied` ⇄ `PermissionDenied`, `notification` ⇄ `Notification`, `instructionsLoaded` ⇄ `InstructionsLoaded`, `todoCreated` ⇄ `TodoCreated`, and `todoCompleted` ⇄ `TodoCompleted`. Commands are emitted verbatim (no `$GEMINI_PROJECT_DIR` rewriting). Qwen's four hook types are supported: `command`, `prompt`, `http` (which carries a `url` and POSTs JSON to it; the type and URL round-trip), and `function`. Per-hook fields added in [Qwen Code PR #2827](https://github.com/QwenLM/qwen-code/pull/2827) round-trip as well: command hooks carry `async` (run in the background), `env` (extra subprocess environment variables), and `shell` (`bash`/`powershell`); http hooks carry `headers` (with `${VAR}` interpolation), `allowedEnvVars` (the env-var allowlist), and `once` (single execution per event per session); `statusMessage` (progress text) applies to both. Command-only fields are emitted only on command hooks and http-only fields only on http hooks. The group-level `sequential` flag (parallel by default) and the top-level `disableAllHooks` switch are both round-tripped, and other top-level keys in `settings.json` are preserved. See the [Qwen Code hooks docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md).

> **Note:** Reasonix hooks are written to a dedicated `.reasonix/settings.json` (project) / `~/.reasonix/settings.json` (global) — a Claude-Code-style but standalone JSON file, separate from the `[permissions]`/`[[plugins]]` TOML config. Unlike Claude Code, each event key maps directly to a **flat array** of hook objects (no `matcher`/`hooks` wrapper): `{ "EventName": [ { "match": "...", "command": "...", "description": "...", "timeout": ... } ] }`. All ten of Reasonix's documented events are mapped — `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `stop` ⇄ `Stop`, `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `subagentStop` ⇄ `SubagentStop`, `postModelInvocation` ⇄ `PostLLMCall`, `notification` ⇄ `Notification`, and `preCompact` ⇄ `PreCompact`. `match` (Reasonix's matcher field name) is honored only on `PreToolUse`/`PostToolUse`; a matcher on any other event is dropped with a warning. The canonical `timeout` field is documented in seconds, while Reasonix's `timeout` is milliseconds, so rulesync converts (`× 1000` on generate, `÷ 1000` on import). Only `command`-type hooks are supported. The `settings.json` file is not documented as holding anything besides hooks today, but rulesync merges non-destructively and never deletes it, in case a future Reasonix version adds other keys. See the [Reasonix Hooks guide](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md).

> **Note:** Grok CLI (xAI Grok Build) hooks are written to a dedicated, standalone `rulesync.json` that Grok auto-discovers from `.grok/hooks/*.json` (project) / `~/.grok/hooks/*.json` (global). The JSON shape is Claude-Code-compatible: each event nests under the top-level `hooks` key as a per-matcher array (`{ "hooks": { "EventName": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": ... } ] } ] } }`). All fourteen documented events map 1:1 onto canonical arms — `sessionStart` ⇄ `SessionStart`, `sessionEnd` ⇄ `SessionEnd`, `beforeSubmitPrompt` ⇄ `UserPromptSubmit`, `preToolUse` ⇄ `PreToolUse`, `postToolUse` ⇄ `PostToolUse`, `postToolUseFailure` ⇄ `PostToolUseFailure`, `permissionDenied` ⇄ `PermissionDenied`, `stop` ⇄ `Stop`, `stopFailure` ⇄ `StopFailure`, `notification` ⇄ `Notification`, `subagentStart` ⇄ `SubagentStart`, `subagentStop` ⇄ `SubagentStop`, `preCompact` ⇄ `PreCompact`, and `postCompact` ⇄ `PostCompact`. A `matcher` (a regex tested against the tool name) is honored on the tool-name events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`), matching Claude Code's semantics; a matcher on any other event is dropped with a warning. Commands are emitted verbatim (Grok documents no project-directory variable). Grok also supports `http` hooks natively, but Rulesync's shared Claude-style converter emits only `command`-type hooks. See the [Grok hooks docs](https://docs.x.ai/build/features/hooks).

> **Note:** Kimi Code hooks are global-only and written as flat `[[hooks]]` entries in `~/.kimi-code/config.toml`, with `event`, `command`, and optional `matcher`/`timeout`. Rulesync maps fourteen canonical lifecycle events to Kimi's PascalCase names: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `stop`, `stopFailure`, `notification`, `subagentStart`, `subagentStop`, `preCompact`, and `postCompact`. Kimi's native `PermissionResult` and `Interrupt` events have no canonical equivalents, but they can be preserved in the `kimi-code.hooks` override. Only `command` hooks are emitted. Kimi normally runs these user-level hooks with each current session project as the working directory, which would let an unrelated repository substitute a relative script or influence commands such as `npm test`. Rulesync therefore wraps every generated command so it first changes to the trusted absolute directory containing the source `.rulesync/hooks.jsonc`; relative paths and project-aware commands consistently resolve against that source rather than whichever repository Kimi later opens. Kimi requires `timeout` to be an integer from 1 to 600 seconds; invalid canonical values are omitted with a warning so Kimi can still load the config. The shared TOML file is merged in place and never deleted. See the [Kimi Code hooks docs](https://moonshotai.github.io/kimi-code/en/customization/hooks.html).

## `.github/mcp.json` and `.copilot/mcp-config.json`

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

This file is used by the GitHub Copilot CLI for MCP server configuration. Rulesync manages it by converting from the unified `.rulesync/mcp.jsonc` format. Both scopes use the same `{ "mcpServers": {...} }` shape but write to different paths:

- **Project mode:** `.github/mcp.json` (relative to project root) — the Copilot CLI auto-loads MCP servers from this workspace config file ([changelog v1.0.61, 2026-06-09](https://github.com/github/copilot-cli)).
- **Global mode:** `~/.copilot/mcp-config.json` (relative to home directory) — the personal/global MCP configuration.

> **Migration note:** earlier Rulesync versions wrote the **project-mode** Copilot CLI MCP config to `.copilot/mcp-config.json` (the same path used for global mode). Project mode now writes the dedicated workspace file `.github/mcp.json` instead, so a previously generated project-scope `.copilot/mcp-config.json` is no longer managed and can be removed by hand.

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

> **Codex CLI deprecation note:** Codex CLI's own docs now state "Custom prompts are deprecated. Use skills for reusable instructions" (see [Custom Prompts](https://developers.openai.com/codex/custom-prompts)). Rulesync's `codexcli` commands still generate the global-only `~/.codex/prompts/*.md` custom-prompt files described above — they remain functional and no removal date has been announced, so this behavior is unchanged for now. For new reusable instructions, prefer rulesync's `codexcli` skills support (see `.rulesync/skills/*/SKILL.md` below) instead.

> **Devin note:** Devin's extensibility docs no longer document a standalone workflows/commands component — reusable prompts invoked as slash commands are [Skills](https://docs.devin.ai/cli/extensibility/skills/overview) (`/name`). Rulesync therefore emits each command onto the native skills surface as `.devin/skills/<name>/SKILL.md` (project) / `~/.config/devin/skills/<name>/SKILL.md` (global, via `--global`), with `name`/`description` frontmatter derived from the command file. The legacy Windsurf/Cascade-era `.devin/workflows/` and `~/.codeium/windsurf/global_workflows/` locations are no longer emitted (stale outputs there stay gitignored but are not cleaned up automatically). Commands import and `--delete` are no-ops for `devin` because the skills feature owns the `.devin/skills/` tree (importing it as commands would double-import every skill). Note that a command and a skill sharing the same name write the same `SKILL.md` path, so keep command and skill names distinct for this target.

> **Hermes Agent note:** Commands are global-only and remain distinct from skills. Rulesync writes JSON command specs to `~/.hermes/rulesync/commands/<name>.json`, installs the `rulesync-commands` plugin under `~/.hermes/plugins/`, and enables it in `~/.hermes/config.yaml`. The plugin registers each spec with Hermes's [`ctx.register_command()` plugin API](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins/) and dispatches the prompt through `delegate_task`; invocation arguments are appended to the prompt. `.rulesync/skills/<name>/SKILL.md` still generates a full [Hermes Agent Skill](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/) under `~/.hermes/skills/<name>/SKILL.md`, which Hermes also exposes as a dynamic slash command. Rulesync rejects command/skill names that would collide in Hermes's slash-command namespace, and rejects nested command paths that flatten to the same name. Generate commands with `rulesync generate --targets hermesagent --features commands --global`.
>
> Releases before this native plugin transport emitted Hermes commands as `~/.hermes/skills/<name>/SKILL.md`. Rulesync cannot distinguish those files from real user-authored skills safely, so remove an obsolete legacy file manually after confirming that `.rulesync/skills/<name>/SKILL.md` does not own it.

> **Qwen Code note:** Custom commands are emitted as **Markdown** files (not TOML — TOML is deprecated upstream) under `.qwen/commands/` (project) and `~/.qwen/commands/` (global, via `--global`). The file is an optional YAML frontmatter block (`description`) followed by the prompt body. Subdirectory namespacing is supported: `.qwen/commands/git/commit.md` becomes the `/git:commit` command. Any extra fields are preserved on round-trip under the `qwencode:` block.

> **OpenCode import note:** OpenCode lets commands live both as Markdown files under `.opencode/commands/*.md` **and** inline in `opencode.json`/`opencode.jsonc` under the top-level `command` key. On import, rulesync reads both: each inline entry's `template` becomes the command body and its `description`/`agent`/`model`/`subtask` fields become frontmatter. A Markdown file takes precedence over an inline entry with the same name.

> **Reasonix note:** Custom slash commands are Markdown files under `.reasonix/commands/` (project) / `~/.reasonix/commands/` (global, via `--global`) — directly analogous to Claude Code's `.claude/commands/`, since Reasonix explicitly mirrors Claude Code's conventions. Frontmatter supports `description` and `argument-hint`, and the body uses the same `$ARGUMENTS` / `$1`…`$N` placeholder syntax. Subdirectory namespacing is supported (`git/commit.md` → `/git:commit`). Any extra fields are preserved on round-trip under the `reasonix:` block. See the [Reasonix GUIDE](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md#slash-commands).

> **Rovo Dev CLI note:** Rovo Dev's "saved prompts" are a file-based custom-command surface made of a `prompts.yml` manifest plus per-prompt Markdown content files, invoked via `/prompts [title] [extra]`. Rulesync writes the content (no frontmatter) to `.rovodev/prompts/<name>.md` (project) / `~/.rovodev/prompts/<name>.md` (global, via `--global`), and rebuilds the sibling `.rovodev/prompts.yml` / `~/.rovodev/prompts.yml` manifest with one `{ name, description, content_file }` entry per prompt, `content_file` pointing at `prompts/<name>.md` (resolved relative to `prompts.yml`, matching Rovo Dev's own resolution order). The `prompts` array is fully replaced from the current rulesync commands on each generate (mirrors the Rovodev MCP adapter fully replacing `mcpServers`); any other top-level key in an existing manifest is preserved, and the manifest is never deleted. See the [saved prompts](https://support.atlassian.com/rovo/docs/save-and-reuse-a-prompt-in-rovo-dev-cli/) and [CLI commands](https://support.atlassian.com/rovo/docs/rovo-dev-cli-commands/) docs.

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
    # Listed tools are emitted verbatim; omit `tools` entirely to grant the agent
    # all tools. `agent/runSubagent` is opt-in — add it explicitly only when this
    # subagent needs to orchestrate other subagents.
    - web/fetch
    - agent/runSubagent
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

> **Qwen Code note:** Subagents are emitted as Markdown + YAML frontmatter under `.qwen/agents/` (project) and `~/.qwen/agents/` (user/global, via `--global`); the body is the subagent's system prompt. Besides the shared `name`/`description`, the `qwencode:` block accepts these optional fields (all preserved on round-trip): `model`, `approvalMode` (`default` | `plan` | `auto-edit` | `yolo` | `bubble`), `tools` (allowlist), `disallowedTools` (denylist), `maxTurns`, `color`, `mcpServers` (per-agent MCP overrides — accepts both a record of server specs, matching Qwen's documented shape, and a plain array of server names), and `hooks` (per-agent hook registrations). See the [Qwen Code sub-agents docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md).

> **Kimi Code note:** Subagents are emitted as Markdown files under `.kimi-code/agents/` (project) and `~/.kimi-code/agents/` (global). The shared `name` and required `description` fields are written to YAML frontmatter; Kimi-specific `whenToUse`, `override`, `tools`, `disallowedTools`, and `subagents` fields can be authored under the `kimi-code:` block and round-trip unchanged. Kimi recursively scans both its Kimi-specific agents directory and the shared `.agents/agents/` directory, so Rulesync imports nested Markdown files from both locations and flattens them into `.rulesync/subagents/<name>.md` using the validated kebab-case agent name. The Kimi-specific root has precedence over `.agents/agents/`; if multiple source files resolve to the same logical agent name, the first one wins and Rulesync warns about the duplicate. The shared root is import-only and is never removed by Kimi-target orphan deletion. See the [Kimi Code custom-agents docs](https://moonshotai.github.io/kimi-code/en/customization/agents.html).

> **Cline note:** Cline file-based agents are emitted as YAML files (`<name>.yaml`) into `.cline/agents/` (project) and `~/.cline/agents/` (global, via `--global`). The file is a YAML frontmatter block (`name` required, `description`) followed by the system prompt body, matching Cline's agent config loader.

> **Devin note:** Devin Local custom subagent profiles are emitted as `AGENT.md` files in a **directory-per-agent** layout: `.devin/agents/<name>/AGENT.md` (project) and `~/.config/devin/agents/<name>/AGENT.md` (global, via `--global`). The directory name `<name>` is the profile id (derived from the rulesync subagent file name). The `AGENT.md` is a YAML frontmatter block followed by the subagent's system prompt. Besides the shared `name`/`description`, the `devin` subagent block accepts these optional fields (all preserved on round-trip): `model` (string, override the subagent LLM), `allowed-tools` (list of strings, restrict available tools), `permissions` (object with `allow`/`deny`/`ask` string lists, override tool permissions), and `max-nesting` (integer, enable nested subagent spawning up to the given depth). See the [Devin subagents docs](https://docs.devin.ai/cli/subagents).

> **Reasonix note:** Reasonix native subagents are Skill profiles emitted as `SKILL.md` files in a **directory-per-agent** layout: `.reasonix/skills/<name>/SKILL.md` (project) and `~/.reasonix/skills/<name>/SKILL.md` (global, via `--global`). The directory name `<name>` is the profile id (derived from the rulesync subagent file name). A subagent is a Skill whose YAML frontmatter declares `invocation: manual` and `runAs: subagent` — Rulesync always injects both markers so the SKILL.md is recognized as a manually invoked subagent rather than an auto-discovered skill. Besides the shared `name`/`description`, the `reasonix` subagent block accepts these optional fields (all preserved on round-trip): `model` (string, subagent LLM), `effort` (string, reasoning effort), `allowed-tools` (list of strings, restrict available tools), and `color` (string, display color). The schema is loose, so any extra keys survive the round-trip. See the [Reasonix subagent profiles docs](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SUBAGENT_PROFILES.md).

> **Roo note (as of 2026-06-16):** Roo Code reads project custom modes from a single aggregated `.roomodes` file at the workspace root (YAML; JSON also accepted). Rulesync therefore collapses every Roo-targeted subagent into that file's `customModes` array — each subagent becomes one mode whose `slug` is derived from the file name (sanitized to `^[a-zA-Z0-9-]+$`), `name`/`description` come from the shared frontmatter, and `roleDefinition` is the subagent body. The optional `roo:` block supplies `groups` (defaults to `["read", "edit", "command", "mcp"]`), `whenToUse`, `customInstructions`, an explicit `slug`, and a `roleDefinition` override. (Roo's previous `.roo/subagents/` output was inert — Roo Code never read it.) See the [Roo custom-modes docs](https://roocodeinc.github.io/Roo-Code/features/custom-modes).

> **OpenCode import note:** OpenCode lets agents live both as Markdown files under `.opencode/agents/*.md` **and** inline in `opencode.json`/`opencode.jsonc` under the top-level `agent` key. On import, rulesync reads both: each inline entry's `prompt` becomes the subagent body (a `"{file:./path}"` reference is resolved relative to the config file's location, as OpenCode does), and the remaining fields (`description`/`mode`/`model`/`tools`/`permission`/...) become frontmatter under the `opencode:` block. A Markdown file takes precedence over an inline entry with the same name.

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

## `.rulesync/checks/*.md`

Code review checks are per-check instructions an agent runs during code review. Each check is a single Markdown file with YAML frontmatter (the source of the check identity is the file name — e.g. `.rulesync/checks/security.md` defines the `security` check).

Example:

```md
---
targets: ["*"] # * = all, or specific tools
description: Flags common security issues # (optional) short summary of the check
severity: high # (optional) low | medium | high | critical
tools: ["Read", "Grep"] # (optional) tool names the check may use
---

Review the diff for injection vulnerabilities, hardcoded secrets, and unsafe
deserialization. Report each finding with a file and line reference.
```

Amp and Hermes Agent consume checks. Amp receives one Markdown file per check:

- **Project scope:** `.agents/checks/<name>.md`
- **Global scope** (`--global`): `~/.config/amp/checks/<name>.md`

For Hermes Agent, Rulesync writes project-local JSON specs under `.hermes/plugins/rulesync-checks/checks/` and a `rulesync-checks` plugin beside them. Its one-shot [`pre_verify` hook](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/#pre-verify) fires only for coding turns with changed paths and `attempt == 0`, then asks Hermes to run all configured checks before finishing. `tools` is preserved as advisory guidance because Hermes does not enforce an Amp-style per-check tool allowlist. Enable and run the project plugin from the project root:

```sh
HERMES_ENABLE_PROJECT_PLUGINS=1 hermes plugins enable rulesync-checks
HERMES_ENABLE_PROJECT_PLUGINS=1 hermes
```

The emitted Amp frontmatter is derived from the source as follows:

| Amp field          | Source                                                   |
| ------------------ | -------------------------------------------------------- |
| `name`             | the source file basename without `.md` (required by Amp) |
| `description`      | `description`                                            |
| `severity-default` | `severity`                                               |
| `tools`            | `tools`                                                  |

The frontmatter schema is loose, so extra Amp-specific keys survive a generate/import round-trip (except keys that collide with a rulesync tool-target name such as `cursor` — those are treated as tool-scoped sections and are not re-emitted). A tool-scoped section (e.g. `amp: { "severity-default": "critical" }`) overrides the canonical values for that tool — the tool-specific value takes precedence, and the section itself is not emitted (except `name`, which always comes from the file name). On import, `severity-default` maps back to the generic `severity` field, and the `name` field is dropped because it is re-derived from the file name on the next generate.

> **v1 limitation:** Amp also discovers subtree-scoped checks (e.g. `api/.agents/checks/`), but rulesync sources carry no directory-placement semantics, so those subtree-scoped checks are not generated. See the [Amp manual](https://ampcode.com/manual).

## `.rulesync/skills/*/SKILL.md`

Example:

```md
---
name: example-skill # skill name
description: >- # skill description
  A sample skill that demonstrates the skill format
targets: ["*"] # * = all, or specific tools
# (optional) shared default for tools that support the flag — claudecode, cursor,
# zed, pi, qwencode, and factorydroid. Any of those tool sections can override it
# by setting their own `disable-model-invocation` value below.
disable-model-invocation: true
# (optional) shared default for tools that support the flag — claudecode, qwencode,
# vibe, and factorydroid. Any of those tool sections can override it by setting
# their own `user-invocable` value below.
user-invocable: false
claudecode: # for claudecode-specific parameters
  model: sonnet # opus, sonnet, haiku, or any string
  when_to_use: When the user asks to review a PR # (optional) extra trigger context appended to description
  allowed-tools: # (optional) tools usable without asking; accepts a string or a list
    - "Bash"
    - "Read"
    - "Write"
    - "Grep"
  disallowed-tools: # (optional) removes these tools while the skill is active (string or list)
    - "WebFetch"
  effort: high # (optional) effort while active: low | medium | high | xhigh | max
  argument-hint: "[pr-number]" # (optional) autocomplete hint for expected arguments
  arguments: # (optional) named positional arguments for $name substitution (string or list)
    - "pr_number"
  context: fork # (optional) set to "fork" to run the skill in a forked subagent context
  agent: code-reviewer # (optional) subagent type to use when context: fork
  shell: bash # (optional) shell for ! command blocks: bash (default) or powershell
  hooks: # (optional) hooks scoped to the skill's lifecycle (free-form per the Claude Code docs)
    PreToolUse:
      - matcher: "Bash"
  disable-model-invocation: true # (optional) disable model invocation for this skill
  user-invocable: false # (optional) hide from the / menu while keeping model access
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
deepagents: # for deepagents-cli (dcode)-specific parameters (optional; Agent Skills standard)
  # Authored as a canonical list; emitted to SKILL.md as a space-delimited string
  # (e.g. "Bash Read") because dcode rejects a YAML list at runtime.
  allowed-tools:
    - "Bash"
    - "Read"
  license: MIT # (optional)
  compatibility: # (optional) free-form compatibility metadata
    deepagents-version: ">=0.1.0"
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
kimi-code: # for Kimi Code-specific parameters (optional; project/global .kimi-code/skills/)
  type: inline # (optional) prompt, inline, or flow
  whenToUse: "When reviewing pull requests" # (optional) model invocation hint
  disableModelInvocation: false # (optional) prevent automatic model invocation
  arguments: ["pull_request"] # (optional) named arguments, also accepts a whitespace-separated string
agentsskills: # for the Agent Skills standard target (optional; supports project + global ~/.agents/skills/)
  license: MIT # (optional)
  compatibility: "Requires Python 3.14+ and uv" # (optional) free-form string, 1–500 chars (an object is also accepted for back-compat)
  metadata: # (optional) free-form metadata (spec-recommended place for skill versioning)
    version: "1.0.0"
  allowed-tools: "shell" # (optional, experimental) space-separated string or list
copilot: # for GitHub Copilot-specific parameters (optional; project .github/skills/, global ~/.copilot/skills/)
  license: MIT # (optional)
  allowed-tools: "shell" # (optional) tools pre-approved without per-use confirmation
copilotcli: # for GitHub Copilot CLI-specific parameters (optional; project .github/skills/, global ~/.copilot/skills/)
  license: MIT # (optional)
  allowed-tools: "shell" # (optional) tools pre-approved without per-use confirmation
  argument-hint: "[message]" # (optional) hint shown for the skill's expected arguments
rovodev: # for Rovo Dev CLI-specific parameters (optional; Agent Skills standard)
  allowed-tools: "grep bash" # (optional) space-separated string (a YAML list is also accepted)
  license: MIT # (optional)
  compatibility: "Requires Python 3.14+ and uv" # (optional) free-form string (object form also accepted)
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
factorydroid: # for Factory Droid-specific parameters (optional)
  disable-model-invocation: true # (optional) prevent the model from auto-invoking this skill
  user-invocable: false # (optional) hide from the slash-command menu, keep model access
takt: # takt specific parameters (optional; emitted under .takt/facets/knowledge/ — frontmatter is dropped on emit)
  name: "renamed-stem" # (optional) override the emitted filename stem (no path separators or "..")
  extends: "base" # (optional) emit a leading `{extends:<parent>}` facet-inheritance directive (Takt 0.39.0+)
qwencode: # for Qwen Code-specific parameters (optional; project .qwen/skills/, global ~/.qwen/skills/)
  priority: 10 # (optional) higher values appear earlier in /skills listings
  paths: # (optional) glob patterns (string or list) gating model discovery to matching files
    - "src/**/*.ts"
  user-invocable: false # (optional) hide from slash-command invocation, keep model access
  disable-model-invocation: true # (optional) hide from the model but allow direct user invocation
vibe: # for Vibe Code-specific parameters (optional)
  user-invocable: false # (optional) hide from slash-command invocation, keep model access
  allowed-tools: "Bash Read" # (optional) space-delimited or list of allowed tool names
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

> **Reasonix note:** Reasonix discovers Anthropic-style directory-layout skills (`<name>/SKILL.md`) under `.reasonix/skills/` (project) / `~/.reasonix/skills/` (global, via `--global`). Rulesync emits the portable `name`/`description` frontmatter (Reasonix supports additional optional keys, but only that pair is modeled); the schema is loose, so any extra keys on an imported `SKILL.md` survive the round-trip. See the [Reasonix GUIDE](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md).

> **Kimi Code note:** Kimi Code discovers skills under `.kimi-code/skills/` (project) and `~/.kimi-code/skills/` (global), plus the shared `.agents/skills/` root at either scope. Rulesync generates the recommended directory layout (`<name>/SKILL.md`) and imports both that layout and flat `<name>.md` skills; for flat files, a missing `name` comes from the filename and a missing `description` falls back to the first non-empty body line (up to 240 characters), matching Kimi. Imported skills are written to `.rulesync/skills/<logical-name>/SKILL.md`, using the normalized logical frontmatter name rather than the source directory or filename. Duplicate precedence follows Kimi's case-insensitive logical frontmatter `name`: the Kimi-specific root takes precedence over `.agents/skills/`, and a directory skill takes precedence over a same-named flat file within one root. Shared roots are import-only and are never removed by Kimi-target orphan deletion. Besides `name`/`description`, Rulesync maps Kimi's `type`, `whenToUse`, `disableModelInvocation`, and `arguments` frontmatter through the `kimi-code:` block and preserves supporting files beside directory-layout `SKILL.md`. The shared top-level `disable-model-invocation` value supplies the Kimi flag unless the tool-specific block overrides it. See the [Kimi Code Agent Skills docs](https://moonshotai.github.io/kimi-code/en/customization/skills.html).

## `.rulesync/mcp.jsonc`

`.rulesync/mcp.jsonc` is the recommended source path and accepts comments and trailing commas. The legacy `.rulesync/mcp.json` path remains readable for existing projects. When both files exist, the JSONC file takes precedence; write flows update the existing source instead of creating a second variant.

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

### Tool-scoped server blocks (`{toolname}.mcpServers`)

Servers under the shared `mcpServers` key are emitted to every targeted tool. To scope a server to a single tool, add a tool-scoped `{toolname}` block alongside it — mirroring `{toolname}.hooks` in `.rulesync/hooks.jsonc` and `{toolname}.permission` in `.rulesync/permissions.jsonc`:

```jsonc
{
  "mcpServers": {
    "shared-server": { "type": "stdio", "command": "echo" },
  },
  "claudecode": {
    "mcpServers": {
      // Added only to Claude Code's MCP config.
      "claude-only-server": { "type": "http", "url": "https://example.com/mcp" },
      // `null` removes a shared server for Claude Code only.
      "shared-server": null,
    },
  },
}
```

- A tool-scoped entry with the same name as a shared server **replaces it wholesale** for that tool (no field-level merge).
- A tool-scoped entry set to `null` **removes** the shared server for that tool.
- Any MCP-capable `--targets` name is accepted as a block key (`claudecode`, `cursor`, `codexcli`, ...). Targets that share one output file resolve identically so the shared file never depends on generation order: the deprecated `claudecode-legacy` target reads the `claudecode` block; the `kiro-cli` / `kiro-ide` targets read the `kiro` block (all three write the same `.kiro/settings/mcp.json`); and the `antigravity-ide` / `antigravity-cli` targets both apply both `antigravity-*` blocks in a fixed order (`antigravity-ide` first, then `antigravity-cli` — the CLI block wins per server) because they share their output file at both scopes (`.agents/mcp_config.json` in project mode, `~/.gemini/config/mcp_config.json` in global mode).

> **Deprecated: per-server `targets`.** The older per-server `"targets": ["tool", ...]` array is still honored as a filter (a missing value or `["*"]` means every tool), but it is deprecated and logs a warning at generate time. Migrate by moving the server into the matching `{toolname}.mcpServers` block(s).

> **JetBrains AI Assistant note:** Rulesync writes the native `{ "mcpServers": { ... } }` configuration to `.ai/mcp/mcp.json` in project mode and `~/.ai/mcp/mcp.json` in global mode. Both scopes support STDIO and remote server entries using the shape documented in [JetBrains AI Assistant's MCP guide](https://www.jetbrains.com/help/ai-assistant/mcp.html).

#### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `.rulesync/mcp.jsonc`:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json",
  "mcpServers": {}
}
```

### Transport types (`type` / `transport`)

The `type` (and the equivalent `transport`) field accepts `local`, `stdio`, `sse`, `http`, `ws`, and `streamable-http`. `streamable-http` is the MCP specification's name for the HTTP transport and is accepted as an alias of `http`, so configurations copied from a server's documentation work unchanged. `ws` is the WebSocket transport (a persistent bidirectional connection) and accepts the same `url`/`headers`/`headersHelper`/`timeout` fields as `http`. Tools that do not recognize a given transport keep it on round-trip but may ignore it at runtime.

> **Kilo Code note:** Kilo's MCP config uses its own native shape in `kilo.jsonc` (`type: "local" | "remote"`, `environment`, `enabled`, `command` as an array). Rulesync maps `stdio`/`local` ⇄ Kilo `local` and `http`/`sse` ⇄ Kilo `remote`; on import, Kilo `remote` is normalized to the canonical `http` transport (the deprecated `sse` is no longer emitted). The Kilo-specific `timeout` (local + remote, a positive integer in milliseconds) and `oauth` (remote only — either an OAuth-config object or `false` to disable auto-detection) fields are preserved on round-trip. The `kilo.jsonc` `skills` config key (`skills.paths` for extra skill locations and `skills.urls` for remote skill manifests) is likewise preserved when Rulesync writes the file.

> **Kimi Code note:** MCP servers are written to `.kimi-code/mcp.json` (project) and `~/.kimi-code/mcp.json` (global). Kimi Code supports stdio, HTTP, and SSE plus `env`, `cwd`, `headers`, `bearerTokenEnvVar`, `enabled`, `startupTimeoutMs`, `toolTimeoutMs`, `enabledTools`, and `disabledTools`; Rulesync preserves the canonical fields that Kimi accepts. Canonical `local` maps to stdio and `streamable-http` maps to HTTP. WebSocket servers are skipped with a warning because Kimi has no WebSocket transport. See the [Kimi Code MCP docs](https://moonshotai.github.io/kimi-code/en/customization/mcp.html).

> **Takt note (partial / transport-allowlist only):** Takt does **not** have a project- or global-level registry of MCP server _definitions_. The concrete `mcp_servers` map (`command`/`args`/`env` or `type`/`url`/`headers`) is declared **per workflow step** inside individual workflow YAML files; there is no top-level `mcp_servers` key in `config.yaml`, and Takt's config loader hard-rejects unknown top-level keys (introduced with MCP support in [Takt v0.21.0](https://github.com/nrslib/takt/blob/main/CHANGELOG.md)). What `config.yaml` _does_ hold is the **default-deny transport allowlist** `workflow_mcp_servers: { stdio, sse, http }` — without it, workflow-defined MCP servers are refused regardless of how they are declared. So Rulesync emits **only** this allowlist into the shared `.takt/config.yaml` (project) / `~/.takt/config.yaml` (global), enabling exactly the transports your `.rulesync/mcp.jsonc` servers use (`local`/`stdio` ⇒ `stdio`; `sse` ⇒ `sse`; `http`/`streamable-http`/`ws` ⇒ `http`). The merge is in place — every other top-level key (`provider`, `provider_profiles`, …) is preserved and the file is never deleted. **Documented lossiness:** per-server names, commands, env, URLs, and headers are not representable in `config.yaml` and are intentionally **not** written; you still declare the concrete servers in your workflow YAML steps, and Rulesync only opens the transport gate that permits them. As a corollary, **import** cannot reconstruct server definitions from a transport allowlist and yields an empty `mcpServers` map. See the [Takt configuration docs](https://github.com/nrslib/takt/blob/main/docs/configuration.md).

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

> **Codex CLI server-name note:** Codex requires MCP server names matching `[a-zA-Z0-9_-]+`, so Rulesync auto-normalizes non-conforming names on generate (lowercase, runs of other characters become `_`, leading/trailing `_` trimmed) — e.g. `Postgres MCP - Production - Read Only` becomes `postgres_mcp_production_read_only`. If two names normalize to the same Codex name, the last processed server overwrites the earlier one (with a warning). A name with no representable characters at all (e.g. a fully Japanese name) falls back to a stable hash-derived name like `mcp_1a2b3c4d` instead of being dropped; rename the server in `.rulesync/mcp.jsonc` to pick a readable Codex name. This normalization is one-way: importing back from the generated `config.toml` yields the normalized name, not the original.

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

#### Codex-specific: OAuth client id (`oauth.clientId` → `client_id`)

A server's `oauth` block is preserved in the canonical Claude Code shape (camelCase `clientId`), but Codex CLI reads the OAuth client id from snake_case `oauth.client_id`. Without it, `codex mcp login <server>` falls back to dynamic client registration and fails for providers that do not support it (e.g. Slack). The codex generator therefore **duplicates** `clientId` into a sibling `client_id`, keeping the camelCase key so tools that expect it keep working:

```toml
[mcp_servers.slack.oauth]
clientId = "1601185624273.8899143856786"
client_id = "1601185624273.8899143856786"
callbackPort = 3118
```

Only a string `clientId` is duplicated (a non-string value would not be a usable OAuth client id), and an explicit `client_id` already present in the source is left untouched. On import, `client_id` collapses back to the canonical `clientId` (and is dropped when both are present) so the round-trip stays stable.

> **Grok CLI note:** MCP servers are written to a `[mcp_servers.<name>]` table in `.grok/config.toml` (project) / `~/.grok/config.toml` (global, via `--global`). The file is treated as shared Grok config: Rulesync only replaces the `mcp_servers` key and preserves every other table on round-trip, and it is never deleted. Unlike Codex CLI, Grok uses a literal `env` table (it does not support the `env_vars` runtime-passthrough list) and has no per-server tool allow/deny lists, so the only field rename is `disabled` (rulesync) ⇄ `enabled = false` (grok); an active server simply omits `enabled`. Servers with no environment variables are emitted without a dangling `[mcp_servers.<name>.env]` table (empty nested tables are stripped), and a server whose entire configuration would be empty is dropped with a warning.

### Goose-specific: MCP servers as `extensions` (global) and open-plugin manifest (project)

Goose configures MCP servers in two locations depending on scope:

- **Global (`--global`):** MCP servers are written as **extensions** in the shared user config `~/.config/goose/config.yaml`. The schema is non-standard, so Rulesync maps canonical MCP fields to Goose's: `command` → `cmd` (an array `command` folds its tail into `args`), `env` → `envs`, `url`/`httpUrl` → `uri`, and `disabled: true` → `enabled: false`. The `type` is derived — `command` ⇒ `stdio`, a remote `url` ⇒ `streamable_http` (or `sse` when the canonical `type` is `sse`). Each extension also carries its own `name`. Generation merges the `extensions:` block into the existing `config.yaml`, preserving other Goose settings (model, provider, ...), and the file is never deleted. This location supports **both stdio and remote** (http/sse) servers.
- **Project:** Goose v1.39.0+ discovers MCP extensions in **open plugins** at `<project>/.agents/plugins/<name>/.mcp.json` (and `~/.agents/plugins/<name>/.mcp.json` at user scope). Rulesync emits `.agents/plugins/rulesync/.mcp.json`, reusing the same `.agents/plugins/rulesync/` tree already used for Goose hooks. The manifest uses the **Claude-style** `{ "mcpServers": { "<name>": { "command", "args", "env", "cwd" } } }` shape. This manifest is **stdio-only** — it cannot express `url`/`headers`, so **remote (http/sse) servers are skipped with a warning** in project mode; sync them with `--global` to `~/.config/goose/config.yaml` instead. The `.mcp.json` manifest is owned by Rulesync and is deleted when no servers remain.

See the [Goose extensions docs](https://block.github.io/goose/docs/getting-started/using-extensions/) and [open-plugins MCP PR #9471](https://github.com/block/goose/pull/9471).

### Goose-specific: commands and subagents as recipes

Goose [recipes](https://block.github.io/goose/docs/guides/recipes/recipe-reference/) are reusable YAML workflow files (`version`, `title`, `description`, plus at least one of `instructions` / `prompt`, and optional `extensions`, `parameters`, `sub_recipes`, …). Rulesync maps:

- **commands → top-level recipes** at `.goose/recipes/<name>.yaml` (project) and `~/.config/goose/recipes/<name>.yaml` (global). The command body becomes the recipe `prompt`.
- **subagents → sub-recipes** at `.goose/recipes/subagents/<name>.yaml` (project) and `~/.config/goose/recipes/subagents/<name>.yaml` (global), referenced from a parent recipe's `sub_recipes` list by relative `path`. The subagent body becomes the recipe `instructions`.

Subagents live in the `subagents/` subdirectory so the command-recipe and subagent-recipe file sets stay disjoint (import and orphan deletion never cross over). `title` defaults to the file name and `description` to the rulesync `description` (falling back to `title`) since recipes require both; `version` defaults to `1.0.0`. Any other recipe field round-trips through the rulesync `goose` section of a command/subagent.

### Vibe-specific: stdio `cwd` and MCP `[auth]` block

Vibe (mistral-vibe) MCP servers live in `[[mcp_servers]]` arrays of the shared `.vibe/config.toml`. In addition to the flat fields, Rulesync passes through the stdio `cwd` (working directory) and a structured per-server `auth` block (Vibe v2.15.0+). The `auth` table is discriminated on `type`: `static` (`headers`, `api_key_env`, `api_key_header`, `api_key_format`) and `oauth` (`scopes`, `client_id` / `client_metadata_url`, `redirect_port`). Because Vibe rejects mixing legacy top-level static-auth keys with an explicit `[auth]` block, Rulesync suppresses the legacy keys (`headers`/`api_key_env`/`api_key_header`/`api_key_format`) whenever a server carries an `auth` block. See [mistral-vibe](https://github.com/mistralai/mistral-vibe) (`vibe/core/config/_settings.py`).

> **Reasonix note:** MCP servers are written as `[[plugins]]` array-of-tables entries (Reasonix's MCP-compatible external plugins) in `reasonix.toml` (project) / `~/.reasonix/config.toml` (global, via `--global`). Each entry carries a `name` plus the standard transport fields: `type` selects the transport (`stdio` default — `command`/`args`/`env`; `http`, a.k.a. `streamable-http` — `url`/`headers`), and the deprecated `sse` transport is collapsed onto `http`. The file is treated as shared Reasonix config: Rulesync only replaces the `plugins` key and preserves every other table (providers, ui, agent, …) on round-trip, and it is never deleted. Reasonix has no per-server tool allow/deny lists, but each plugin entry may carry an optional `trusted_read_only_tools` array (raw MCP tool names pre-seeded as trusted for planner/read-only use); it also supports `call_timeout_seconds` (a per-server MCP call timeout) and `tool_timeout_seconds` (a per-tool inline table keyed by raw MCP tool name). None of these have a deep canonical mapping, so they round-trip as passthrough fields on the canonical MCP server object. See the [Reasonix plugins guide](https://github.com/esengine/deepseek-reasonix/blob/main-v2/docs/GUIDE.md#plugins-mcp) and [SPEC.md](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md) (`[[plugins]]` schema).

## `.rulesync/.aiignore` or `.rulesyncignore` (deprecated)

> **Deprecation notice:** The `ignore` feature is deprecated in favor of the more expressive [`permissions` feature](#rulesync-permissions-jsonc). Existing ignore configurations, generation, import, conversion, and explicit `rulesync add ignore` scaffolding remain supported throughout Rulesync 14.x. Removal, if any, will be decided separately and will not occur before a future major release. `rulesync init` no longer enables or scaffolds ignore for new projects.

Rulesync continues to support a single legacy ignore list in either location:

- `.rulesync/.aiignore` (preferred legacy location)
- `.rulesyncignore` (older project-root location)

Rules and behavior:

- You may use either location.
- When both exist, Rulesync prefers `.rulesync/.aiignore` over `.rulesyncignore` when reading.
- Explicitly running `rulesync add ignore` creates `.rulesync/.aiignore` when neither location exists.

Example:

```ignore
tmp/
credentials/
```

### Migrating to permissions

Move each ignore pattern into the `read` category of `.rulesync/permissions.jsonc` with the `deny` action:

```jsonc
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/permissions-schema.json",
  "permission": {
    "read": {
      "tmp/**": "deny",
      "credentials/**": "deny",
    },
  },
}
```

This is the closest replacement for preventing an agent from reading ignored paths. If the old policy was also intended to prevent changes, repeat the patterns under `edit` and `write`. Target tools differ in the permission categories they can represent, so review the [Supported Tools and Features](./supported-tools.md) table and the tool-specific permission notes below before removing the old ignore feature from a multi-tool project.

### Where ignore patterns are written per tool

Most tools get a dedicated ignore file (for example `.cursorignore`,
`.geminiignore`, `.clineignore`). Antigravity CLI is built on the same engine
as Gemini CLI, so it reads the project-root `.geminiignore` file. Claude Code is the exception: it does not
read a separate ignore file, so Rulesync writes the deny list into Claude
Code's settings file as `permissions.deny` entries (`Read(<pattern>)`).

Hermes Agent uses a project-local `rulesync-ignore` plugin under `.hermes/plugins/`. It applies the canonical gitignore-style patterns through [`pre_tool_call`](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/#pre-tool-call) to `read_file`, `write_file`, and `patch` before execution, and filters ignored paths from `search_files` results through `transform_tool_result`. This is defense in depth around Hermes file tools; terminal commands and paths already present in conversation context are outside the plugin's enforcement surface. Hermes deliberately requires [explicit trust for project plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins/), so enable and run it from the project root:

```sh
HERMES_ENABLE_PROJECT_PLUGINS=1 hermes plugins enable rulesync-ignore
HERMES_ENABLE_PROJECT_PLUGINS=1 hermes
```

For Cursor, Rulesync emits only `.cursorignore` — the file that **blocks access
entirely** (semantic search, Tab, Agent, Inline Edit, and `@`-mentions). Cursor
also supports a second file, `.cursorindexingignore`, which excludes files from
**indexing only** while keeping them accessible to the AI on demand. These two
files mean _different_ things, and Rulesync's `ignore` feature models a single
canonical ignore list per tool with no per-pattern distinction between
"block access" and "exclude from indexing only". Emitting the same patterns to
both files would be incorrect, so `.cursorindexingignore` is intentionally **not
generated** (an intentional non-goal). Author it by hand if you need
indexing-only excludes.

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

## `.rulesync/permissions.jsonc`

`.rulesync/permissions.jsonc` is the recommended source path and accepts comments and trailing commas. The legacy `.rulesync/permissions.json` path remains readable for existing projects. When both files exist, the JSONC file takes precedence; write flows update the existing source instead of creating a second variant.

`rulesync init` scaffolds a `codexcli` block with `approval_policy: "on-request"`, `approvals_reviewer: "auto_review"`, and `base_permission_profile: ":danger-full-access"`. On generation, the profile value becomes Codex's top-level `default_permissions`.

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

### Tool-scoped permission blocks (`{toolname}.permission`)

The shared `permission` block applies to every targeted tool. To scope rules to a single tool, add a tool-scoped `{toolname}` block with a `permission` record of the same shape — mirroring `{toolname}.hooks` in `.rulesync/hooks.jsonc` and `{toolname}.mcpServers` in `.rulesync/mcp.jsonc`:

```jsonc
{
  "permission": {
    "bash": { "git *": "allow", "*": "ask" },
  },
  "claudecode": {
    "permission": {
      // Replaces the shared `bash` category for Claude Code only.
      "bash": { "git *": "allow", "git push *": "deny", "*": "ask" },
    },
  },
}
```

- Categories are merged **per category**: a tool-scoped category replaces the shared category wholesale for that tool; shared categories it does not name still apply.
- Any permissions-capable `--targets` name is accepted as a block key. `kiro-cli`/`kiro-ide` alias to the `kiro` key and `hermesagent` to `hermes` (matching the shared output file each writes).
- OpenCode, Kilo, and Vibe keep their existing tool-native `permission` override semantics (bare action strings / tool-only categories / `sensitive_patterns` — see the tool-specific callouts below); their blocks are consumed by their translators instead of the central merge.

#### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `.rulesync/permissions.jsonc`:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/permissions-schema.json",
  "permission": {}
}
```

For Claude Code, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in `.claude/settings.json` (project mode) or `~/.claude/settings.json` (global mode) using PascalCase tool names (e.g., `Bash(git *)`, `Edit(src/**)`, `Read(.env)`).

> **Claude Code-only override (`claudecode` key):** Claude Code's `permissions` object also carries non-list fields with no canonical permission category — notably `defaultMode` (the session-start permission mode: `default` | `acceptEdits` | `plan` | `bypassPermissions`) and `additionalDirectories` (extra working directories). Add a tool-scoped `claudecode` override key alongside the shared block to author them: the fields under `claudecode.permissions` are merged into the settings `permissions` object and emitted **only** for Claude Code, while the shared `permission` block continues to drive the managed `allow`/`ask`/`deny` arrays. The block is a verbatim passthrough (so other/future `permissions` fields such as the org locks `disableBypassPermissionsMode`/`disableAutoMode` can be set too), but any `allow`/`ask`/`deny` placed inside it is ignored — rulesync owns those arrays. On import, the non-list `permissions` fields round-trip back into the `claudecode` override. Note that these fields are merged **additively** into the existing `settings.json` (so hand-added settings survive): removing a field from the `claudecode` override does not delete a value already written to `settings.json` — clear it there by hand.
>
> ```json
> {
>   "permission": { "bash": { "git *": "allow" } },
>   "claudecode": {
>     "permissions": { "defaultMode": "acceptEdits", "additionalDirectories": ["../shared"] }
>   }
> }
> ```

For OpenCode, this generates the `permission` object in `opencode.json` / `opencode.jsonc` (project mode) or `.config/opencode/opencode.json` / `.config/opencode/opencode.jsonc` (global mode), preserving other existing OpenCode config fields. OpenCode's `webfetch`, `websearch`, `todowrite`, `question`, and `doom_loop` keys accept only a single action string, so Rulesync emits their canonical `{ "*": "allow" }` form as `"allow"`. If one of these categories contains pattern-specific rules, Rulesync collapses them to the most restrictive action (`deny` > `ask` > `allow`) and logs a warning because OpenCode cannot represent those patterns; a map without `*` includes an implicit `ask` fallback so a narrow allowlist never becomes blanket `allow`, while an empty map becomes `deny` instead of falling through to OpenCode's default allow behavior.

> **OpenCode-only override (`opencode` key):** OpenCode exposes permission categories that other tools do not understand (e.g. `external_directory`). Placing these in the shared `permission` block would push meaningless entries into Claude Code, Codex, etc. To scope them to OpenCode, add a tool-scoped `opencode` override key alongside the shared block — mirroring the tool-scoped override keys used by [hooks](#hooks) (`opencode.hooks`) and rules frontmatter. Categories under `opencode.permission` are merged on top of the shared block **per category** (the override wins) and are emitted **only** into `opencode.json` / `opencode.jsonc`; every other tool ignores them. Values may use a bare action string (`"deny"`) or, for OpenCode keys that support fine-grained matching, a pattern map (`{ "*": "ask" }`).
>
> ```jsonc
> {
>   "permission": {
>     "bash": { "git *": "allow", "*": "ask" },
>   },
>   // Emitted only into opencode.json's `permission`; never leaks to other tools.
>   "opencode": {
>     "permission": {
>       "external_directory": "deny",
>     },
>   },
> }
> ```
>
> On **import**, any OpenCode category that is not a shared canonical rulesync category (`bash`, `read`, `edit`, `write`, `webfetch`, `websearch`, `grep`, `glob`, `notebookedit`, `agent`, the all-tools key `*`, or an `mcp__*` tool name) is routed into the `opencode` override rather than the shared block, so a subsequent `rulesync generate` does not leak it into other tools.
>
> You may also override a **shared** category for OpenCode specifically (e.g. put `webfetch` under `opencode.permission` to give OpenCode a different value than the shared block sends to other tools). On generate this works as expected, but note the override is not round-trip stable for shared categories: re-importing the generated `opencode.json` classifies a shared category back into the shared block, so prefer expressing OpenCode-only categories here and keeping cross-tool categories in the shared block.

For Hermes Agent, permissions are written into the shared `~/.hermes/config.yaml` (global only). Canonical rules map onto the structures Hermes's runtime actually enforces:

- `allow` patterns (all categories) → `command_allowlist`.
- `bash` `deny` patterns → `approvals.deny` — Hermes's hard denylist, evaluated **before** `--yolo` / `approvals.mode: off`.
- `webfetch` `deny` patterns → `security.website_blocklist.domains`.
- Every `ask` rule, and `deny` rules in categories other than `bash`/`webfetch`, have no native per-pattern Hermes primitive; they survive only for round-trip (Rulesync also stores the full canonical config under a private `permissions.rulesync` key so `.rulesync/permissions.jsonc` reconstructs losslessly).

> **Hermes-only override (`hermes` key):** Hermes exposes approval/security controls with no canonical permission category — e.g. `approvals` (`mode`, `cron_mode`, `mcp_reload_confirm`, ...), `security` (`allow_private_urls`, ...), `skills.write_approval`, `memory.write_approval`. Add a tool-scoped `hermes` override key alongside the shared block to author them; its contents are **deep-merged** into `config.yaml` (so an `approvals.mode` here coexists with the `approvals.deny` derived from canonical deny rules) and are emitted **only** for Hermes. The block is a verbatim passthrough, so any current or future Hermes config key can be set without Rulesync modeling each one. Note that the deep merge replaces **arrays** wholesale, so setting `hermes.approvals.deny` or `hermes.security.website_blocklist.domains` overrides (does not append to) the list derived from the shared `permission` block — use it only when you intend to replace the canonical-derived deny list for Hermes. The top-level `permissions` key is reserved by Rulesync for the round-trip blob, so a `permissions` key inside the `hermes` override is ignored.
>
> ```json
> {
>   "permission": { "bash": { "rm -rf *": "deny" } },
>   "hermes": { "approvals": { "mode": "smart" }, "security": { "allow_private_urls": false } }
> }
> ```

For Codex CLI, this generates a `rulesync` named profile in `.codex/config.toml` under `[permissions.rulesync]` and sets `default_permissions = "rulesync"` (project/global depending on mode). It also generates `.codex/rules/rulesync.rules` from `permission.bash` entries using `prefix_rule(...)`. Current Rulesync-to-Codex mapping supports `bash`, `read`, `edit`/`write`, and `webfetch` categories:

- `bash`: generates one `prefix_rule(...)` per command pattern in `.codex/rules/rulesync.rules` (`allow` → `allow`, `ask` → `prompt`, `deny` → `forbidden`)
- `read`: `allow` → `read`, `ask`/`deny` → `deny` in `permissions.<profile>.filesystem`
- `edit` / `write`: `allow` → `write`, `ask`/`deny` → `deny` in `permissions.<profile>.filesystem`
- `webfetch`: `allow`/`deny` map to `permissions.<profile>.network.domains` (Codex does not support `ask` for domain rules); `network.enabled = true` is emitted only when at least one `allow` rule is present. Deny-only domain sets are emitted without `enabled`, which Codex treats as restricted (its default) while the deny entries still round-trip back into Rulesync rules. Codex rejects the global wildcard `*` in denied domains at config load time, so `webfetch: { "*": "deny" }` is skipped with a warning (unlisted domains are denied by Codex's allowlist-first policy anyway); `webfetch: { "*": "allow" }` is emitted as a regular `"*" = "allow"` domain entry, which Codex accepts for denylist-only setups ([openai/codex#15549](https://github.com/openai/codex/pull/15549)). On import, `deny` entries are always taken, while `allow` entries are imported only when `enabled = true` is explicit — Codex treats a missing `enabled` as restricted, so importing an allow entry from a disabled profile would activate a grant Codex never had. A Codex profile with `network.enabled = true` but no `domains` is imported as `webfetch: { "*": "allow" }`, which reflects Codex's default semantics where `enabled = true` grants sandbox-wide network access (under Codex's experimental `network_proxy` feature, `enabled = true` without an allowlist blocks requests instead, and the regenerated `"*" = "allow"` entry is the closest equivalent).

Relative filesystem globs such as `src/**` or `**/*.tf` are emitted under `permissions.<profile>.filesystem.":workspace_roots"` instead of the top-level filesystem table, because Codex expects top-level filesystem keys to be absolute paths, `~/...`, or named roots. Rulesync also sets `glob_scan_max_depth = 8` when generated workspace-root rules contain unbounded `**` patterns.

The `:workspace_roots` table also receives a default `.git` carve-out: `".git/**" = "write"`. Codex's `:workspace` baseline keeps `.git` read-only inside workspace roots, which denies basic git workflows (commit/stage operations write to `.git/index`, `.git/objects`, refs, and logs; everyday commands such as `git remote add`, `git push -u`, and local-scope `git config` write to `.git/config`). The write rule reopens the whole subtree, including `.git/config` — an earlier `".git/config" = "read"` security guard (a writable `.git/config` lets a sandboxed process set keys like `core.fsmonitor` or `core.hooksPath` that execute code outside the sandbox) was dropped because it blocked those everyday commands while the protection it added was already partial (`.git/hooks/`, and `.git/modules/**` for submodules, remains writable so hook managers such as lefthook and simple-git-hooks keep working; a sandboxed process could still install a hook directly). Users who want stricter isolation can author a more specific rule (e.g. `read: { ".git/config": "allow" }` or `read: { ".git/hooks/**": "allow" }`) in the canonical permissions, which wins over the default (Codex resolves the more specific path with priority). Because `.git/**` is an unbounded `**` pattern, the carve-out also means `glob_scan_max_depth = 8` is effectively always emitted unless it is suppressed.

The carve-out is skipped in three cases: a user rule for the same pattern always wins per key; the `codexcli.git_write_rules` override set to `false` suppresses it entirely (only an explicit `false` does; the default is `true`); and it is not injected when `codexcli.base_permission_profile` is `":read-only"` (it would grant `.git` write access inside a sandbox the user explicitly chose to keep read-only) or when the canonical rules contain a direct `":workspace_roots"` pattern (a whole-tree access decision that the defaults must not override). Like `:minimal`, the default-valued carve-out is not imported into the Rulesync model on `rulesync import` — it is re-added on every generate — while customized `.git` values import normally. One limitation: the `git_write_rules` flag itself cannot be recovered from `config.toml`, so it does not round-trip through `rulesync import`; if you opted out with `false`, re-add the flag to the canonical permissions config after importing (and if you want the same `.git` rules while opted out, author them as canonical `read`/`write` rules rather than hand-writing them in `config.toml` — though note that import cannot tell a user-authored `".git/**" = "write"` from the default carve-out, so that exact pattern/value pair is still skipped on import and must be re-authored in the canonical config afterwards). Migration note: configs generated before the `".git/config" = "read"` default was removed still carry that entry, and `rulesync import` now treats it as a user-authored rule — it lands in the canonical config as `read: { ".git/config": "allow" }` and, because Codex gives the more specific path priority, keeps `.git/config` read-only on every regenerate. If you want the current writable default instead, delete that rule from the canonical permissions after importing.

The generated `[permissions.rulesync]` profile always extends one of Codex's built-in permission profiles via `extends`. The baseline is chosen with the `codexcli.base_permission_profile` override key (`":read-only"` | `":workspace"` | `":danger-full-access"`) and defaults to `":workspace"` when unspecified. Codex's built-in `:workspace` baseline grants read access to the whole filesystem and write access to the entire workspace root plus `/tmp` and `$TMPDIR` (with carve-outs protecting `.git`, `.codex`, and `.agents`), while `:read-only` keeps command execution read-only; the generated `filesystem` entries then grant or deny access on top of the chosen baseline. Codex's third built-in profile, `:danger-full-access`, is rejected by `extends` at Codex config load time — so selecting it works differently: Rulesync emits `default_permissions = ":danger-full-access"` directly and skips the managed `[permissions.rulesync]` profile entirely (with the sandbox removed there is nothing for filesystem/network rules to refine; canonical `read`/`edit`/`write`/`webfetch` rules are ignored for Codex CLI with a warning, and any stale managed profile from a previous generate is pruned while sibling hand-written profiles are preserved). On import, a profile's `extends` value round-trips back into `codexcli.base_permission_profile` when it names one of the two extendable built-ins, and a top-level `default_permissions = ":danger-full-access"` round-trips the same way; a custom parent profile is skipped and replaced by the managed baseline on regeneration (with a warning).

Rulesync emits `":minimal" = "read"` in the generated filesystem table by default. This enables `include_platform_defaults()` ([FileSystemSpecialPath::Minimal](https://github.com/openai/codex/pull/13434)), which provides the platform/runtime read access needed for basic sandboxed command execution on macOS, Linux, and Windows. `:minimal` is the only special path treated as a fixed baseline: it is always present in the generated table and is never imported into Rulesync's own permission model, regardless of its value. A canonical rule for `:minimal` still overrides the emitted value on generate (e.g. a `write: { ":minimal": "allow" }` rule emits `":minimal" = "write"` — see the [FAQ](../faq.md#codex-cli-denies-ssh-agent-access-temp-dir-writes-or-reading-its-own-config-with-a-generated-permissions-profile) for when that is needed), but because import always skips `:minimal`, such a customization does not round-trip: after `rulesync import`, re-author the rule or the next generate falls back to `"read"`. The other special paths `:root`, `:tmpdir`, and `:slash_tmp` are user-managed access rules that are imported into the Rulesync model and re-emitted from it like any ordinary filesystem entry (`:root = "deny"` becomes a read/edit deny, `:tmpdir = "write"` becomes an edit allow, and so on). Because they round-trip through `.rulesync/permissions.jsonc` rather than relying on an existing `.codex/config.toml`, a restrictive value such as `:root = "deny"` survives a fresh-clone `rulesync generate` with no pre-existing Codex config.

`network.mode`, `network.unix_sockets`, and `description` have no equivalent in Rulesync's canonical permissions model and are not generated. If an existing `.codex/config.toml` already contains these fields on the `rulesync` profile, Rulesync preserves them on regeneration — as it does any other network key it does not model (e.g. `dangerously_allow_all_unix_sockets` or Codex's proxy keys), since network settings are user territory by design. `network.enabled` is only half-managed: Rulesync sets `enabled = true` itself when the canonical model contains an allow domain, but when a regeneration computes no `enabled` value, a user-authored `enabled` is preserved (with a warning) instead of being deleted — see the [FAQ](../faq.md#codex-cli-denies-ssh-agent-access-temp-dir-writes-or-reading-its-own-config-with-a-generated-permissions-profile) for the recommended user-managed entries. The preservation applies only when the existing profile carries no allow domain: an existing `enabled` next to allow domains is Rulesync's own managed output, so removing every webfetch allow rule from the canonical model removes `enabled` too (falling back to Codex's restricted default) instead of leaving an unscoped `enabled = true` behind. Note that `filesystem`, `network.domains`, and `extends` are always managed by Rulesync (`filesystem`/`network.domains` derived from `edit`/`write`/`webfetch` rules, `extends` from `codexcli.base_permission_profile`), so hand-authored values in those fields will be replaced on regeneration.

> **Codex CLI-only override (`codexcli` key):** Codex CLI's permission surface is richer than the canonical allow/ask/deny model — its approval workflow, permission-profile baseline, and per-app tool gating have no canonical category. Add a tool-scoped `codexcli` override to author them: except for `base_permission_profile`, its fields are written verbatim as **top-level `.codex/config.toml` keys** (the override wins per key; existing sibling keys the user set directly are preserved, and table values are shallow-merged) while the shared `permission` block keeps driving the managed `[permissions.rulesync]` profile and `default_permissions`. Supported keys: `base_permission_profile` (`:read-only` | `:workspace` | `:danger-full-access`, default `:workspace` — not a top-level key; it becomes the managed profile's `extends` baseline, or with `:danger-full-access` the directly-selected `default_permissions` value, see above), `approval_policy` (`untrusted` | `on-request` (legacy alias `on-failure`) | `never`, or a `{ granular = { … } }` table kept verbatim; defaults to `on-request` when neither the override nor the existing config sets it), `apps` (per-app tool gating — `apps.<id>.tools.<tool>.approval_mode` / `.enabled`, `apps.<id>.default_tools_approval_mode`), `approvals_reviewer` (`user` | `auto_review` (legacy alias `guardian_subagent`), or a table; defaults to `auto_review` when neither the override nor the existing config sets it), and `git_write_rules` (boolean, default `true` — like `base_permission_profile` it is not a top-level key: it controls whether the managed profile's `:workspace_roots` table emits the default `.git` carve-out described above; only an explicit `false` suppresses it). **Deprecated:** `sandbox_mode` (`read-only` | `workspace-write` | `danger-full-access`) with the sibling `sandbox_workspace_write` table (`network_access`, `writable_roots`, …) belong to Codex's classic sandbox system, which permission profiles supersede — Codex prioritizes these legacy keys over permission profiles when both are present, so authoring them disables the generated `[permissions.rulesync]` profile; they are still accepted (with a warning) so existing configs round-trip, but use `base_permission_profile` and the shared `permission` block instead. On import, the top-level keys round-trip back into the `codexcli` override, and the managed profile's `extends` round-trips into `base_permission_profile`. It is a `looseObject`, so future top-level Codex config keys can be authored here (merged verbatim on generate; only the listed keys are re-extracted on import). Example: `{ "permission": { … }, "codexcli": { "base_permission_profile": ":workspace", "approval_policy": "on-request", "approvals_reviewer": "auto_review" } }`. **Out of scope:** `mcp_servers.*` per-MCP gating is **not** authorable here — it is owned by the MCP feature (`codexcli-mcp.ts` writes the `mcp_servers` tables in the same `config.toml`), and `permissions` / `default_permissions` are owned by the canonical model; any such key placed in the override is skipped with a warning. See the [Codex configuration reference](https://developers.openai.com/codex/config-reference) and [permissions docs](https://developers.openai.com/codex/permissions).

For Kiro, this generates tool permission settings in `.kiro/agents/default.json` (project mode):

- `bash` maps to `toolsSettings.shell.allowedCommands` / `toolsSettings.shell.deniedCommands`
- `read` maps to `toolsSettings.read.allowedPaths` / `toolsSettings.read.deniedPaths`
- `edit` / `write` map to `toolsSettings.write.allowedPaths` / `toolsSettings.write.deniedPaths`
- `grep` maps to `toolsSettings.grep.allowedPaths` / `toolsSettings.grep.deniedPaths`
- `glob` maps to `toolsSettings.glob.allowedPaths` / `toolsSettings.glob.deniedPaths` (both emitted only when a rule is present, so existing configs do not gain empty tables)
- `webfetch` / `websearch` with pattern `*` map to `allowedTools` entries (`web_fetch` / `web_search`)
- `ask` rules are skipped with a warning (Kiro config does not support explicit ask entries)

> **Kiro-only override (`kiro` key):** Kiro's agent config exposes per-tool `toolsSettings` knobs with no canonical allow/ask/deny category. Author them through a tool-scoped `kiro` override under `toolsSettings`: the shell auto-trust flags `shell.autoAllowReadonly` / `shell.denyByDefault`, the `aws` built-in tool's `allowedServices` / `deniedServices` (+ `autoAllowReadonly`), and the `web_fetch` domain trust arrays `trusted` / `blocked` (regex host patterns; Kiro documents these for `web_fetch` only — `web_search` has no domain-trust surface). Example: `{ "permission": { … }, "kiro": { "toolsSettings": { "shell": { "autoAllowReadonly": true }, "aws": { "allowedServices": ["s3"], "deniedServices": ["eks"] }, "web_fetch": { "trusted": [".*github\\.com.*"] } } } }`. The override is **deep-merged per `toolsSettings` key** (the override wins at the leaf) so authoring `shell.autoAllowReadonly` keeps the canonical-generated `shell.allowedCommands`; the shared `permission` block keeps driving `shell.{allowed,denied}Commands`, `read`/`write`/`grep`/`glob` paths, and the `web_fetch`/`web_search` `allowedTools` toggles. Existing non-canonical `shell` flags are preserved across regenerate even without an override. On **import**, these Kiro-specific surfaces are lifted into the `kiro` override so they round-trip. It is a `looseObject` at every level, so future Kiro `toolsSettings` fields pass through verbatim. **Out of scope:** Kiro's MCP `autoApprove` / `disabledTools` lists are **not** modeled here — they live in a separate file (`.kiro/settings/mcp.json`, under `mcpServers.<name>`), not the agent config this translator writes, and reconciling them with the canonical `mcp__*` model is a distinct design question. See the [Kiro built-in tools](https://kiro.dev/docs/cli/reference/built-in-tools/) and [configuration reference](https://kiro.dev/docs/cli/custom-agents/configuration-reference/) docs.

For Cursor CLI, this generates `permissions` entries in `.cursor/cli.json` (project mode) or `~/.cursor/cli-config.json` (global mode). Cursor CLI only supports `allow` and `deny` decisions, so `ask` rules are skipped with a warning. Tool categories are mapped to PascalCase Cursor tool names (`bash` → `Shell`, `read` → `Read`, `edit`/`write` → `Write`, `webfetch` → `WebFetch`, `mcp__*` → `Mcp`). Existing Cursor-specific entries that Rulesync does not manage (for example, MCP entries with extra fields) are preserved on round-trip.

> **Cursor-only override (`cursor` key):** Cursor's `cli.json` carries scalar autonomy settings with no canonical permission category — `approvalMode` (`allowlist` | `auto-review` | `unrestricted`) and a `sandbox` object (`mode`/`networkAccess`). Add a tool-scoped `cursor` override to author them: its fields are merged into the top level of `cli.json` while the shared `permission` block keeps driving the `permissions.allow`/`permissions.deny` arrays (the override cannot clobber that managed block). On import, `approvalMode` and `sandbox` round-trip back into the `cursor` override. It is a `looseObject`, so `sandbox`'s (currently undocumented) value set passes through verbatim and extra `cli.json` keys can be authored here (they are merged verbatim on generate); note that only `approvalMode` and `sandbox` are re-extracted on import.
>
> ```json
> {
>   "permission": { "bash": { "git *": "allow" } },
>   "cursor": { "approvalMode": "auto-review" }
> }
> ```
>
> The separate Cursor **IDE** `permissions.json` (`mcpAllowlist`, `terminalAllowlist`, `autoRun.*`) is a different file and is not targeted by this translator.

For GitHub Copilot (`copilot`), this manages the `chat.tools.terminal.autoApprove` map in the workspace `.vscode/settings.json` (project mode only). VS Code has no standalone, environment-agnostic Copilot policy file, so project-level terminal auto-approvals are configured through VS Code Copilot Chat's workspace settings. The scope is deliberately limited to this one clean, non-lossy mapping: only the canonical `bash` (terminal command) category is mapped — `allow` → `true` (auto-approve) and `deny` → `false` (never auto-approve); an `ask` rule is represented by **omitting** the entry, so VS Code falls through to its default in-chat approval prompt. Other canonical categories (`read`/`edit`/`webfetch`/…) have no terminal-command equivalent in this setting and are not emitted. `.vscode/settings.json` is a general workspace file (JSONC), so Rulesync merges only the single `chat.tools.terminal.autoApprove` key non-destructively and never deletes the file; every unrelated setting is preserved. VS Code's user-scope `settings.json` lives at a platform-dependent path outside Rulesync's home-relative global model, so only project scope is supported. The all-or-nothing `chat.tools.global.autoApprove` boolean and the registry-allowlist `chat.mcp.access` setting are intentionally **not** mapped, since collapsing per-pattern rules into them would misrepresent what was configured. See the [VS Code agent approvals docs](https://code.visualstudio.com/docs/agents/approvals).

For Kilo Code, this generates the `permission` object in `kilo.jsonc` (project mode) or `~/.config/kilo/kilo.jsonc` (global mode). The shape is identical to OpenCode's (Kilo is an OpenCode fork), so categories like `bash`, `read`, `edit`, `write`, `webfetch`, and `mcp` accept either a string catch-all (`"allow" | "ask" | "deny"`) or a `{ <pattern>: <action> }` map. Other top-level keys in `kilo.jsonc` are preserved on round-trip. **The `permission` object is merged per top-level tool key**: for each tool key present in the rulesync output, that key is replaced entirely from rulesync (rulesync owns its managed keys; manual edits inside a managed key will be overwritten on the next generation). Tool keys that exist in the existing `kilo.jsonc` but are NOT in the rulesync output are preserved verbatim so user-added Kilo-only categories survive regeneration. When a regenerate replaces a key whose existing value contained `deny` patterns that disappear from the new rulesync output, an aggregated `logger.warn` enumerates the dropped patterns (matching the project convention used by every other permissions translator). Edits to other top-level keys (e.g. `model`) are preserved. **Malformed `kilo.jsonc` aborts the run**: the `jsonc-parser` library would otherwise silently coerce a syntax error to `{}` and overwrite the corrupted file with an empty `permission`, dropping the user's existing `deny` rules. Rulesync now surfaces parse errors so the run aborts before any destructive write — matching the strict `JSON.parse` behavior used by every other permissions translator.

> **Kilo-only override (`kilo` key):** Kilo's `permission` object carries tool-specific keys with no canonical permission category — OpenCode-inherited ones (`external_directory`, `doom_loop`, `lsp`, `question`, `todowrite`, `skill`, `task`, `list`) and Kilo-unique ones (`agent_manager`, `notebook_read`, `notebook_edit`, `notebook_execute`, `repo_clone`, `repo_overview`). Add a tool-scoped `kilo` override key alongside the shared block (mirroring the `opencode` override) to author these; entries under `kilo.permission` are merged on top of the shared block **per key** (the override wins) and are emitted **only** into `kilo.jsonc`. Each value may be a bare action string or a pattern map. On **import**, any Kilo key that is not a shared canonical category (`bash`, `read`, `edit`, `webfetch`, `websearch`, `grep`, `glob`, the all-tools key `*`, or an `mcp__*` tool name) is routed into the `kilo` override rather than the shared block, so a subsequent `rulesync generate` does not leak it into other tools.
>
> **Name-mismatch traps.** Canonical category names do not always match Kilo's key names: Kilo folds **`write` into `edit`** (there is no `write` key), uses **`notebook_edit`** (not the canonical `notebookedit`) and **`task`/`agent_manager`** (not `agent`), and has **no `mcp` key** (MCP is addressed via `mcp__*` tool-name keys). Rulesync passes key names through verbatim, so author Kilo keys using Kilo's own names (e.g. put a `notebook_edit` rule under `kilo.permission`, not the canonical `notebookedit`). Kilo also treats a `null` action as a delete sentinel; Rulesync does not model `null` and only round-trips `allow`/`ask`/`deny`.

For AugmentCode CLI, this generates `toolPermissions` entries in `.augment/settings.json` (project mode) or `~/.augment/settings.json` (global mode). Each entry has `toolName`, an optional `shellInputRegex` (only for shell commands), and `permission.type` ∈ `"allow" | "deny" | "ask-user"`. Tool category mapping: `bash` → `launch-process`, `read` → `view`, `edit` → `str-replace-editor`, `write` → `save-file`, `webfetch` → `web-fetch`, `websearch` → `web-search`. Action mapping: rulesync `ask` → AugmentCode `ask-user`. For `bash` patterns other than `*`, the glob pattern is converted to a regex and emitted as `shellInputRegex`. The glob → regex conversion maps `*` to `.*`, `?` to `.`, escapes `\^$.|+(){}[]`, and anchors at both ends; characters outside that set (notably `-`, `/`, `:`, `,`) are emitted verbatim, so Augment will match them literally. Generated entries are sorted **deny first, ask second, allow last**, with more specific patterns (those carrying `shellInputRegex`) before catch-alls — this is required because Augment's `toolPermissions` is evaluated **first-match-wins**. Existing `toolPermissions` entries whose `toolName` is NOT in the rulesync-managed set are preserved on round-trip; existing **`deny` entries for ANY managed `toolName`** (`launch-process`, `view`, `str-replace-editor`, `save-file`, `web-fetch`, `web-search`) are also preserved (fail-closed) so a user-added deny rule on any managed tool cannot be silently downgraded by regeneration. Existing managed-tool `allow` / `ask-user` entries are still replaced (rulesync owns the permissive surface for managed namespaces). **Non-bash categories do not have a documented per-input matcher in AugmentCode**, so Rulesync emits at most one catch-all entry per tool: if the rulesync category contains any `deny` rule, Rulesync emits a single `deny` entry for the entire tool (fail-closed) and warns; otherwise only `*`-pattern allow/ask rules are emitted and any non-`*` allow/ask patterns are dropped with a warning. Importing AugmentCode entries back into rulesync recovers `bash` patterns from `shellInputRegex` but the other categories always import as the catch-all `*` pattern. **The import direction also applies fail-closed precedence** when multiple existing entries collapse to the same `(canonical, "*")` key (e.g. `[{view: deny}, {view: allow}]`): the most restrictive action wins regardless of iteration order (precedence: `deny` > `ask` > `allow`), so a user-added deny in the source file is never silently dropped by import order. The `launch-process` (bash) path is unchanged because each entry has its own `shellInputRegex`-derived pattern with no `"*"` collapse. On **import** (project scope), Rulesync also reads the layered overrides file `<workspace>/.augment/settings.local.json` — a gitignored, machine-specific file that Auggie merges on top of `settings.json` — and combines it over the base settings before converting to the canonical model, following Auggie's documented layering (simple values take the local override, `mcpServers`/`plugins` replace wholesale, and other objects/lists — including `toolPermissions`, which Auggie concatenates local-first under first-match — are combined across tiers), so personal permission overrides are picked up without dropping a committed base `deny`. This overlay is **import-only and project-only**: Rulesync never writes `settings.local.json` (it stays a user-owned, gitignored file), and AugmentCode documents no global `~/.augment/settings.local.json`, so the overlay is skipped in global mode. An unknown top-level key such as `recommendedMarketplaces` (added in Auggie CLI 0.20.0) is preserved verbatim through the generate round-trip via the `{...settings}` merge.

> **AugmentCode-only override (`augmentcode` key):** AugmentCode's `toolPermissions[]` supports "custom policy" entries the canonical allow/ask/deny model cannot express — `permission.type` of `webhook-policy` / `script-policy` (delegating the decision to a `webhookUrl` / `script`) and an `eventType` of `tool-response` (a post-execution check rather than the default pre-execution `tool-call`). Author these through a tool-scoped `augmentcode` override with a `toolPermissions` array of verbatim entries: `{ "permission": { … }, "augmentcode": { "toolPermissions": [ { "toolName": "github-api", "permission": { "type": "webhook-policy", "webhookUrl": "https://api.example.com/validate" } }, { "toolName": "view", "eventType": "tool-response", "permission": { "type": "allow" } } ] } }`. Authored entries are **prepended** — ahead of the canonical-generated basic rules — so a webhook/script gate or tool-response check is never shadowed by a regenerated allow/deny/ask entry under first-match-wins. When the override authors `toolPermissions` it becomes the source of truth for the special entries (the existing file's specials are no longer separately preserved, avoiding a double-emit); without an override, any special entries already present in `settings.json` are preserved verbatim as before. On **import**, special entries are lifted verbatim into the `augmentcode` override (rather than being skipped with a warning) so they round-trip and become user-authorable; basic entries continue to drive the shared `permission` block. The entry objects stay a loose passthrough so `shellInputRegex`, `webhookUrl`, `script`, and future non-policy fields survive untouched, while the documented bounded fields are validated as enums: `permission.type` (`allow` | `deny` | `ask-user` | `webhook-policy` | `script-policy`) and `eventType` (`tool-call` | `tool-response`). Both project and global scope are supported.

For Factory Droid, this generates `commandAllowlist` / `commandDenylist` arrays in `.factory/settings.json` (project mode) or `~/.factory/settings.json` (global mode). Factory Droid only gates **shell commands** through these two lists, so only the rulesync `bash` category is translated: `allow` patterns become `commandAllowlist` entries (run without confirmation) and `deny` patterns become `commandDenylist` entries (always require confirmation; the denylist wins when a command is in both). Factory Droid has **no separate `ask` list** — any command not in the allowlist already prompts — so rulesync `ask` rules are dropped. Categories other than `bash` cannot be represented in the command allow/deny model and are skipped, with a `logger.warn` when a skipped category carries a `deny` rule (to surface the gap). rulesync owns the `commandAllowlist` / `commandDenylist` keys (they are replaced from the rulesync output), while every other key in `settings.json` (e.g. `hooks`) is preserved verbatim on round-trip — except the Factory-specific security keys covered by the `factorydroid` override below, which are lifted into that override on import. Importing reads the two lists back into the `bash` category.

> **Factory Droid-only override (`factorydroid` key):** Factory Droid has security controls that do not fit the per-command `allow`/`ask`/`deny` model — the hard-block `commandBlocklist` tier (commands that can **never** run, not even under full autonomy — distinct from an approvable `deny`), plus `networkPolicy` (`allowedIps`), `sandbox` (`enabled`/`mode`/`filesystem`/`network`), `mcpPolicy`, `enableDroidShield`, and autonomy settings (`sessionDefaultSettings`, `maxAutonomyLevel`, `interactionMode`). Add a tool-scoped `factorydroid` override to author them: its keys are merged into `settings.json` (the override wins) while the shared `permission` block keeps driving `commandAllowlist`/`commandDenylist`. On **import**, these keys are lifted into the `factorydroid` override — so `commandBlocklist` now round-trips faithfully (its never-runs guarantee is preserved) rather than being collapsed onto an approvable `deny`.
>
> ```json
> {
>   "permission": { "bash": { "git *": "allow" } },
>   "factorydroid": { "commandBlocklist": ["curl *"], "sandbox": { "enabled": true } }
> }
> ```

For Cline CLI, this generates `.cline/command-permissions.json` (project mode only). Cline reads this file via the `CLINE_COMMAND_PERMISSIONS` environment variable; you can wire it up with `export CLINE_COMMAND_PERMISSIONS=$(cat .cline/command-permissions.json)`. The schema is `{ "allow": [...], "deny": [...], "allowRedirects": false }`. Cline only supports shell commands and only `allow`/`deny`. Non-`bash` categories are dropped and rulesync `ask` rules for `bash` are **translated to `deny`** (fail-closed safety, since Cline lacks `ask` semantics); both translation notices are surfaced via a single aggregated `logger.warn` per generation (matching the project convention used by every other permissions translator) so the translation stays visible without tripping CI gates that treat error lines as failures. **The `allow` array is wholesale-replaced by rulesync** — user-added entries inside `allow` are not preserved on regenerate. **The `deny` array is additive** — user-added denies in the existing file are preserved on every generation alongside the rulesync-derived denies (fail-closed standard). The `allowRedirects` field (a single global boolean gating shell redirection operators `>`/`>>`/`<`) can be authored from rulesync via a tool-scoped **`cline` override** — add `"cline": { "allowRedirects": true }` alongside the shared `permission` block. Precedence: the `cline` override wins, otherwise the existing file value is preserved, otherwise it defaults to `false`. On import, a `true` value round-trips back into the `cline` override (the default `false` emits no override). Cline does not have a stable per-user file location for command permissions, so global mode is not supported. If a pattern ends up in **both** `allow` and `deny` (defensive check; not reachable from a single rulesync config), Rulesync emits a warning because Cline does not document a deterministic deny-priority.

For Zed, this generates the `agent.tool_permissions` object in `.zed/settings.json` (project mode) or `~/.config/zed/settings.json` (global mode). Each canonical category becomes a key under `agent.tool_permissions.tools.<tool>` (tool-name mapping: `bash` → `terminal`, `read` → `read_file`, `edit` → `edit_file`, `webfetch` → `fetch`, `websearch` → `web_search`; unknown categories, including `mcp:<server>:<tool>` keys, pass through unchanged). Within a category, the catch-all `*` pattern sets the per-tool `default`, while specific patterns become `always_allow` / `always_deny` / `always_confirm` entries of the form `{ "pattern": <regex>, "case_sensitive": false }`. Action mapping: rulesync `ask` ⇄ Zed `confirm` (`allow`/`deny` are shared). Because Zed matches with regular expressions, patterns are emitted verbatim — author canonical patterns as regexes when targeting Zed. The settings file is shared with the MCP (`context_servers`) and ignore (`private_files`) features, so writes merge non-destructively: unrelated settings, the top-level `agent.tool_permissions.default`, and any `tools.<tool>` entries NOT managed by rulesync are preserved on round-trip. The canonical model has no slot for per-pattern case sensitivity, so rulesync always emits `case_sensitive: false`; a hand-authored `case_sensitive: true` on a rulesync-managed tool is overwritten on the next generate.

For Qwen Code, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in `.qwen/settings.json` (project mode) or `~/.qwen/settings.json` (global mode). The format mirrors Claude Code's: entries are `Bash(<pattern>)`, `Read(<pattern>)`, `Edit(<pattern>)`, `Write(<pattern>)`, `WebFetch(<pattern>)`, `WebSearch(<pattern>)`, `Grep(<pattern>)`, `Glob(<pattern>)`, `Agent(<pattern>)`, etc. Other top-level keys in `settings.json` are preserved on round-trip. Patterns may contain nested parentheses (e.g. `Bash(echo (a))`); Rulesync uses the **last** `)` as the closing delimiter when parsing, so inner parens round-trip. Malformed entries (missing closing paren, trailing characters) emit a warning; for **`deny`** they fall back to the catch-all pattern `*` (fail-closed: broadening a deny is the safer direction), but for **`allow` / `ask`** they are **dropped** rather than broadened — silently turning a narrow user rule into `*` would be a fail-open round-trip. Generation does not create the `.qwen/` directory until `writeAiFiles` runs, so dry-run is side-effect-free.

For Kimi Code, permissions are global-only and generate `[[permission.rules]]` entries in `~/.kimi-code/config.toml`. Canonical categories map to Kimi tool patterns (`bash` → `Bash`, `read` → `Read`, `write` → `Write`, `edit` → `Edit`, `grep` → `Grep`, `glob` → `Glob`, `websearch` → `WebSearch`, `webfetch` → `FetchURL`, `agent` → `Agent`, and `mcp__…` passes through as the MCP tool name); a `*` canonical pattern emits the bare tool name and a specific pattern emits `Tool(pattern)`. Actions map 1:1 to Kimi's `allow` / `ask` / `deny`, and generated rules use `scope = "user"`. Kimi evaluates rules first-match-wins, so Rulesync sorts canonical output fail-closed: all `deny` rules precede `ask`, all `ask` rules precede `allow`, and more-specific patterns precede broader patterns within each action. Kimi does not match MCP tool arguments; an argument-specific MCP `allow`/`ask` is skipped with a warning rather than broadened, while an argument-specific `deny` becomes a whole-tool deny with a warning. The optional `kimi-code.defaultPermissionMode` override writes Kimi's top-level `default_permission_mode` (`manual` / `yolo` / `auto`), while `kimi-code.rules` accepts native rules that canonical categories cannot express and emits them first in their authored order. On import, Rulesync preserves the complete ordered rule list under `kimi-code.rules`, including rules that could otherwise fit the shared permission model, so regeneration cannot change Kimi's first-match behavior. The TOML file is shared with hooks and other Kimi settings, so updates merge in place and never delete the file. See the [Kimi Code permission docs](https://moonshotai.github.io/kimi-code/en/configuration/config-files.html).

> **Qwen-only override (`qwencode` key):** Qwen's `settings.json` exposes autonomy/sandbox controls with no canonical permission category — under `tools` (`approvalMode` = `plan`/`default`/`auto-edit`/`auto`/`yolo`, `autoAccept`, `sandbox`, `sandboxImage`, `disabled`), `security` (`folderTrust`), and `permissions.autoMode` (the Auto Mode classifier config: `hints.{allow,softDeny,hardDeny}`, `environment`, `classifyAllShell`). Add a tool-scoped `qwencode` override to author them: `qwencode.tools` and `qwencode.security` are shallow-merged into the matching `settings.json` group at the **top level of that group** (an unrelated sibling key such as `tools.core` is preserved, an override key wins, and a nested object the override supplies such as `security.folderTrust` replaces the existing one wholesale rather than being deep-merged), while `qwencode.autoMode` is emitted as `permissions.autoMode` (replacing the existing `autoMode` wholesale) and the shared `permission` block keeps driving the `permissions.allow`/`ask`/`deny` arrays. On import, the documented autonomy keys (`tools.{approvalMode,autoAccept,sandbox,sandboxImage,disabled}`, `security.folderTrust`, and `permissions.autoMode`) round-trip back into the override; other `tools`/`security` keys are left in `settings.json` and not extracted.
>
> ```json
> {
>   "permission": { "bash": { "*": "allow" } },
>   "qwencode": {
>     "tools": { "approvalMode": "auto-edit" },
>     "security": { "folderTrust": { "enabled": true } },
>     "autoMode": { "hints": { "allow": ["Running tests"] }, "classifyAllShell": true }
>   }
> }
> ```
>
> **Alias overlap:** Qwen's `Read` is a meta-tool that also covers grep/glob/list, so canonical `grep`/`glob` rules are emitted as their own `Grep(...)`/`Glob(...)` entries but overlap Qwen's `Read` category at runtime; and Qwen folds web search into `web_fetch`, so a canonical `websearch` rule (`WebSearch(...)`) may not correspond to a distinct Qwen tool. `tools.disabled` is a hard whole-tool disable (stronger than `deny`) and is only authorable via the override, not the canonical `deny`.

For Warp, this generates the `agent_mode_command_execution_allowlist` / `agent_mode_command_execution_denylist` regex arrays under the `[agents.profiles]` table of Warp's global user `settings.toml` (**global mode only** — Warp has no project-scoped permissions file). The settings file path differs per platform: macOS `~/.warp/settings.toml`, Linux `~/.config/warp-terminal/settings.toml`, Windows `%LOCALAPPDATA%\warp\Warp\config\settings.toml`. Only the `bash` category maps (`allow` → allowlist, `deny` → denylist); Warp matches commands with **regular expressions**, so patterns are emitted verbatim — author canonical `bash` patterns as regexes when targeting Warp (mirrors Zed). Warp has no per-command `ask` list, so `ask` rules are dropped, and non-`bash` categories are skipped (with a warning when they carry `deny` rules). On import, a pattern present in both lists resolves to `deny` (Warp's denylist wins). The `[agents.profiles]` block is merged into the existing `settings.toml`, preserving other Warp settings, and the file is never deleted. **rulesync owns the two command lists** (it is the source of truth): the `allowlist`/`denylist` are replaced from the rulesync config on each `--global` generate, so a manually curated Warp allowlist/denylist not mirrored in `.rulesync/permissions.jsonc` is overwritten — keep command permissions in rulesync. MCP allow/deny is a separate Warp surface not modeled here. See the [Warp agent profiles & permissions docs](https://docs.warp.dev/agent-platform/capabilities/agent-profiles-permissions/).

> **Warp-only override (`warp` key):** Warp's `[agents.profiles]` table also exposes file-read/read-only autonomy knobs that do not fit the per-command `allow`/`ask`/`deny` model — `agent_mode_coding_permissions` (`always_ask_before_reading` / `always_allow_reading` / `allow_reading_specific_files`), `agent_mode_coding_file_read_allowlist` (an array of paths the agent may read), and `agent_mode_execute_readonly_commands` (a boolean auto-executing read-only commands). Add a tool-scoped `warp` override to author them: its keys are merged into `[agents.profiles]` (the override wins) while the shared `permission` block keeps driving the `agent_mode_command_execution_allowlist`/`_denylist` command arrays. On **import**, these keys are lifted from `settings.toml` into the `warp` override, so they round-trip faithfully instead of being dropped. Example:
>
> ```json
> {
>   "permission": { "bash": { "git .*": "allow" } },
>   "warp": {
>     "agent_mode_coding_permissions": "always_allow_reading",
>     "agent_mode_execute_readonly_commands": true
>   }
> }
> ```
>
> See the [Warp settings reference](https://docs.warp.dev/terminal/settings/all-settings/).

For the Antigravity IDE, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in the committable workspace `.antigravity/settings.json` (**project mode only**). Antigravity 2.0 evaluates these `Deny > Ask > Allow` and uses `action(target)` entries; rulesync maps canonical categories onto the IDE action vocabulary: `read` → `read_file`, `edit`/`write` → `write_file`, `bash` → `command`, `webfetch`/`websearch` → `read_url`, `mcp` → `mcp` (the IDE-only `execute_url` / `unsandboxed` actions have no canonical equivalent and pass through verbatim). Because `edit`/`write` collapse to `write_file` and `webfetch`/`websearch` collapse to `read_url`, importing normalizes back to `write` / `webfetch` (a documented, lossy mapping). The `settings.json` file holds other workspace settings, so the `permissions` block is merged in place — entries for unmanaged actions are preserved — and the file is never deleted. The User-scope settings file is a platform-dependent VS-Code-style path outside rulesync's home-relative global model, so **global mode is not supported**; the workspace file is intended to be checked into git. See the [Antigravity permissions docs](https://antigravity.google/docs/permissions).

For the Antigravity CLI (`agy`), this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in the global `~/.gemini/antigravity-cli/settings.json` (**global mode only**). The CLI shares Antigravity 2.0's Fine-Grained Permissions Engine with the IDE, so the same `action(target)` vocabulary and `Deny > Ask > Allow` precedence apply: `read` → `read_file`, `edit`/`write` → `write_file`, `bash` → `command`, `webfetch`/`websearch` → `read_url`, `mcp` → `mcp` (the engine-only `execute_url` / `unsandboxed` actions pass through verbatim). Because `edit`/`write` collapse to `write_file` and `webfetch`/`websearch` collapse to `read_url`, importing normalizes back to `write` / `webfetch` (a documented, lossy mapping). The `settings.json` holds other CLI settings, so the `permissions` block is merged in place — entries for unmanaged actions are preserved — and the file is never deleted. Two CLI-only autonomy/sandbox knobs outside the allow/ask/deny arrays can be authored (and round-trip) through an optional `antigravity-cli` override block in `.rulesync/permissions.jsonc`: `toolPermission` (the global autonomy preset — `request-review` (default) / `proceed-in-sandbox` / `always-proceed` / `strict`) and `enableTerminalSandbox` (a boolean confining agent-run commands to OS containment). Antigravity applies the allow/deny lists as per-rule exceptions to the preset at runtime, so rulesync authors these keys verbatim as top-level siblings of `permissions` with no precedence modeling. This override is **CLI-only** — the Antigravity IDE exposes the same concepts through a GUI with no documented JSON schema, so it does not apply to `antigravity-ide`. Example: `{ "permission": { … }, "antigravity-cli": { "toolPermission": "strict", "enableTerminalSandbox": true } }`. Verified against the [Antigravity CLI reference](https://antigravity.google/docs/cli/reference) and [sandbox docs](https://antigravity.google/docs/cli/sandbox). See the [Antigravity CLI permissions docs](https://antigravity.google/docs/cli-permissions).

For Rovo Dev CLI, this generates the `toolPermissions` block of the global `~/.rovodev/config.yml` (**global mode only** — Rovo Dev has no project-scoped permissions file, mirroring the Rovodev MCP adapter). Rovo Dev's three levels (`allow`/`ask`/`deny`) are an exact 1:1 with rulesync's canonical actions, so action values pass through verbatim. The `bash` category maps the catch-all `*` pattern to `bash.default` and every other pattern to a `bash.commands[]` entry `{ command: <pattern as regex>, permission }` (Rovo Dev matches commands as regexes, so author `bash` patterns accordingly). The `read` category maps to the inspection tools (`open_files`, `expand_code_chunks`, `expand_folder`, `grep`) and `edit`/`write` to the mutation tools (`find_and_replace_code`, `create_file`, `delete_file`, `move_file`); because these per-tool keys hold a single level (no per-pattern rules), only the catch-all `*` of each category sets the level. Because `edit` and `write` both map onto the same mutation tools, a conflicting catch-all between them cannot be represented; `edit` takes precedence and a warning is logged. Non-catch-all `allow` paths in those categories are surfaced as `allowedExternalPaths` so explicit grants are not dropped; non-`allow` non-catch-all rules cannot be expressed per-path and are skipped with a warning. Categories without a clean Rovo Dev target (e.g. `webfetch`) are skipped with a warning. `config.yml` holds all of Rovo Dev's settings (`agent`, `sessions`, `mcp`, etc.), so the `toolPermissions` block is merged in place — every other top-level key (and any unmanaged keys inside `toolPermissions`) is preserved (values only — YAML comments and formatting in the existing file are not retained on rewrite) — and the file is never deleted. See the [Rovo Dev CLI settings](https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings/) and [tool permissions](https://support.atlassian.com/rovo/docs/use-tools-in-rovo-dev-cli/) docs.

For Goose, this generates the `user` block of the global `~/.config/goose/permission.yaml` (**global mode only** — Goose persists per-tool permission overrides only under the home directory and has no project-scoped permissions file). Goose stores permissions as a YAML map of mode key → `{ always_allow, ask_before, never_allow }`, where each field is a list of tool-name strings; rulesync writes the user-set decisions under the `user` key. Action mapping is a 1:1: `allow` → `always_allow`, `ask` → `ask_before`, `deny` → `never_allow`. Tool-name mapping: `bash` → `developer__shell`, `edit` → `developer__text_editor`; every other category passes through verbatim as the Goose tool name (so namespaced tools like `developer__text_editor` or `developer__image_processor` round-trip). Because Goose permission lists hold **whole tool names** rather than per-command/per-path globs, only a category's catch-all `*` pattern is representable — non-catch-all patterns are skipped with a warning. `write` collapses onto `developer__text_editor` too, so a conflicting `edit`/`write` catch-all cannot be represented; `edit` takes precedence and a warning is logged. The `permission.yaml` file is merged in place: the `user` block is owned by rulesync, while every other top-level key (notably the `smart_approve` LLM-decision cache) is preserved, and the file is never deleted. See the [Goose tool permissions docs](https://goose-docs.ai/docs/guides/managing-tools/tool-permissions/).

For the Grok Build CLI (`grokcli`), this generates Grok's Claude-style `[permission]` rule arrays — `allow` / `deny` / `ask` — in the project `./.grok/config.toml` (project mode) or the user `~/.grok/config.toml` (global mode, via `--global`). Grok documents that "Project configs are limited to MCP servers, plugins, and permission rules, not full user configs" ([settings docs](https://docs.x.ai/build/settings)), so the fine-grained `[permission]` rules are valid at both scopes. Each canonical `permission.<category>.<pattern>` becomes a Grok entry bucketed into the matching array: `bash`→`Bash`, `read`→`Read`, `edit`→`Edit`, `grep`→`Grep`, `webfetch`→`WebFetch`, and `mcp__<server>__<tool>`→`MCPTool(<server>__<tool>)`; a `*` pattern emits the bare tool name (e.g. `Bash`) and a concrete pattern emits `Tool(pattern)` (e.g. `Bash(git *)`). `write` collapses onto `Edit` (Grok has no separate `Write` tool — a documented lossy mapping), and categories with no Grok tool (`websearch`, `glob`, `notebookedit`, `agent`) are skipped, with a warning when a skipped category carries a `deny` rule. Grok evaluates the arrays with precedence `deny > ask > allow`, which import mirrors (a tool listed in multiple arrays resolves to the strictest action). The coarse `[ui] permission_mode` toggle (`"ask"` / `"always-approve"`) is still written as a backward-compatible fallback for older Grok versions: `always-approve` when the config is pure-`allow`, otherwise `ask` (conservative — never `always-approve` while any `deny`/`ask` rule exists, so it never contradicts the fine-grained arrays). On import, the `[permission]` arrays are parsed back into canonical categories when present; only when no `[permission]` section exists do we fall back to the coarse mode (`always-approve` ⇄ `bash: { "*": "allow" }`, `ask`/unset ⇄ `bash: { "*": "ask" }`). `config.toml` is shared with the MCP feature, so rulesync owns the `[permission]` `allow`/`deny`/`ask` arrays and `[ui] permission_mode` while every other key (e.g. `[mcp_servers]`, verbose `[permission] rules`, `[sandbox]`) is preserved, and the file is never deleted. See the [Grok CLI settings reference](https://docs.x.ai/build/settings/reference) and [modes docs](https://docs.x.ai/build/modes-and-commands).

For Vibe (mistral-vibe), this generates per-tool `[tools.<tool>]` tables in the shared `.vibe/config.toml` (project mode) or `~/.vibe/config.toml` (global mode). Tool-name mapping: `bash` → `bash`, `read` → `read_file`, `edit`/`write` → `write_file`, `webfetch` → `fetch`, `websearch` → `search_web`. Within a category, the catch-all `*` pattern sets the per-tool `permission` (`allow` → `always`, `ask` → `ask`) and also toggles the top-level `enabled_tools` / `disabled_tools` filters; specific patterns become **`allowlist` / `denylist`** entries — these are the keys Vibe's permission engine actually reads (`BaseToolConfig`), so the legacy `allow` / `deny` keys are dropped on generate (still honored as a fallback on import). Vibe has no per-pattern `ask`, so pattern-level `ask` rules are skipped with a warning. The `config.toml` file is shared with the MCP and hooks features, so writes merge non-destructively and the file is never deleted. See [mistral-vibe](https://github.com/mistralai/mistral-vibe) (`vibe/core/tools/base.py`).

> **Vibe-only override (`vibe` key):** Vibe's `BaseToolConfig` also carries a `sensitive_patterns` list — patterns that escalate to **ASK even when the base permission is ALWAYS** (allow). The canonical model can only set a pattern to a single `allow`/`ask`/`deny`, so an "allow by default but ask on these patterns" escalation cannot be expressed in the shared block. Add a tool-scoped `vibe` override to author it: `vibe.permission.<category>.sensitive_patterns` carries the list per canonical category (e.g. `bash`, `edit`), while the shared `permission` block still sets the base permission and allow/deny lists. On import, a tool's `sensitive_patterns` round-trips back into the `vibe` override (the base allow stays in the shared block). rulesync owns the list for any category named in the override (a present list is set, an empty one clears it); categories not named keep whatever the existing `config.toml` had.
>
> ```json
> {
>   "permission": { "bash": { "*": "allow" } },
>   "vibe": { "permission": { "bash": { "sensitive_patterns": ["rm *", "sudo *"] } } }
> }
> ```

For Takt, this generates the `default_permission_mode` under `provider_profiles.<provider>` in the shared `.takt/config.yaml` (project mode) or `~/.takt/config.yaml` (global mode). Takt does not have per-tool / per-pattern rules; tool gating is a single coarse mode per provider profile, ordered `readonly` < `edit` < `full` (`readonly` may only read, `edit` may also edit/write files, `full` may also run shell commands). The active provider is named by the top-level `provider:` key (defaulting to `claude`). The mapping is therefore **lossy**: on generate, a single mode is derived with this precedence — (1) any `deny` rule anywhere ⇒ `readonly` (conservative — keep the narrowest mode whenever the user expressed any restriction); (2) else any `edit`/`write` category `allow` rule ⇒ `edit`; (3) else any `bash` category `allow` rule ⇒ `full`; (4) else ⇒ `readonly` (safe default). On import, `full` ⇄ `bash: { "*": "allow" }`, `edit` ⇄ `edit: { "*": "allow" }`, and `readonly` (or an unset/unknown mode) ⇄ `bash: { "*": "deny" }`. `config.yaml` is shared with other Takt settings, so the mode is merged in place — every other provider profile and all other top-level keys are preserved — and the file is never deleted.

Two Takt-specific surfaces with no canonical category can be authored (and round-trip) through an optional `takt` override block in `.rulesync/permissions.jsonc`: `step_permission_overrides` (a per-workflow-step map `<step>` ⇒ `readonly`/`edit`/`full`, written inside the active provider profile and layered by Takt on top of `default_permission_mode`) and `provider_options` (a top-level, per-provider table of sandbox/network knobs orthogonal to the mode, e.g. `codex.network_access`, `claude.sandbox.allow_unsandboxed_commands`, `opencode.allowed_tools`). Example: `{ "permission": { … }, "takt": { "step_permission_overrides": { "ai_review": "readonly" }, "provider_options": { "codex": { "network_access": true } } } }`. Note the workflow-step `required_permission_mode` floor is a field of the **workflow YAML**, not `config.yaml`, so it is intentionally out of scope (Takt's config loader hard-rejects unknown top-level keys). See the [Takt configuration docs](https://github.com/nrslib/takt/blob/main/docs/configuration.md).

For Amp, this writes to the shared `.amp/settings.json` (project mode) or `~/.config/amp/settings.json` (global mode), using **two** permission surfaces. In rulesync's canonical model the category name **is** the Amp tool name. A **whole-tool deny** (pattern `*`) is written to the bare `amp.tools.disable` array (the tool name is pushed verbatim, preserving `builtin:` prefixes and the `*` glob) for backwards compatibility. Every **lossy** case is written to the ordered `amp.permissions` array instead of being dropped: an **argument-specific deny** (pattern `!== "*"`) becomes `{ tool, action: "reject", matches: { cmd: <pattern> } }`, and every `allow` / `ask` rule becomes `{ tool, action, matches?: { cmd } }` (the `matches` object is omitted for the `*` catch-all). Amp evaluates `amp.permissions` **first-match-wins**, so generated entries are ordered deterministically and fail-closed: sorted by tool name, then entries **with** `matches.cmd` (more specific) before catch-alls, then by action priority **`reject` < `ask` < `allow`**, then by `cmd`. `amp.permissions` is Amp's documented **legacy / backwards-compatibility** surface — it remains functional and is the only place to express `allow`/`ask` and argument-specific `reject` rules. **Ownership:** rulesync OWNS and wholesale-replaces the `allow`/`ask`/`reject` entries on every generate, but **preserves any existing `action: "delegate"` entry** (rulesync's canonical model has no `delegate` equivalent); preserved `delegate` entries are placed **after** the rulesync-generated entries (so the regenerated rules take precedence under first-match-wins). On **import**, both keys are read and merged into one canonical config: `amp.tools.disable[tool]` → `{ tool: { "*": "deny" } }`, and each `amp.permissions` entry → `{ tool: { (matches?.cmd ?? "*"): mapped } }` (`reject` → `deny`, `allow` → `allow`, `ask` → `ask`; `delegate` is skipped). When both sources target the same tool+pattern, the **most restrictive action wins** (`deny` > `ask` > `allow`). The settings file is shared with the MCP feature (`amp.mcpServers`), so all other keys are preserved on round-trip and the file is never deleted. Tool names and `cmd` patterns that are prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are skipped defensively.

Amp shapes with no canonical category are authored (and round-trip) through an optional `amp` override block in `.rulesync/permissions.jsonc`: `permissions` — extra `amp.permissions` entries with non-`cmd` matchers (`path`/`url`/`query`/…), regex/array match values, `context` (`thread`/`subagent`), `delegate` (+`to`), or `reject` (+`message`), appended **after** the canonical-generated entries (so generated allow/ask/reject rules take precedence under first-match-wins, with authored entries as later fallbacks); `mcpPermissions` — Amp's `amp.mcpPermissions` array; `guardedFiles` — `amp.guardedFiles.allowlist` (globs allowed without confirmation); and `dangerouslyAllowAll` — `amp.dangerouslyAllowAll`. When the override authors `permissions` it becomes the source of truth for the extra entries; otherwise any hand-authored `delegate` entry in the existing file is preserved. On import, `amp.permissions` entries that are **not** canonical-expressible (non-`cmd` matcher, `delegate`, `reject`+`message`, `context`) are lifted verbatim into `amp.permissions` of the override rather than dropped. Example: `{ "permission": { … }, "amp": { "dangerouslyAllowAll": false, "guardedFiles": { "allowlist": ["docs/**"] }, "permissions": [{ "tool": "Bash", "action": "delegate", "to": "approve.sh" }] } }`. See the [Amp manual](https://ampcode.com/manual).

For JetBrains Junie CLI, this generates the Action Allowlist `rules` object in `.junie/allowlist.json` (project mode) or `~/.junie/allowlist.json` (global mode). Junie evaluates the allowlist top-to-bottom (first match wins) and groups rules into four buckets, onto which rulesync categories map: `bash` → `executables`, `edit`/`write` → `fileEditing`, `read` → `readOutsideProject`, `mcp` → `mcpTools`. Each rule carries an `action` plus either a literal `prefix` (matches commands that start with it) or a glob `pattern` (`*`, `**`, `?`, `[abc]`, `[!abc]`); rulesync emits `pattern` when the canonical pattern contains a glob metacharacter (`*`, `?`, `[`) and `prefix` otherwise. Junie documents only `allow` and `ask` as valid actions — there is **no `deny`** — so a canonical `deny` is downgraded to the nearest valid action, `ask` (which still withholds auto-approval), with a warning, rather than emitting a `deny` Junie would silently ignore (`allow`/`ask` map 1:1). Categories Junie cannot represent (e.g. `webfetch`, `websearch`) are skipped with a warning when they carry rules. rulesync **owns the `rules` object** (it is replaced from the rulesync output on each generate). Because `edit`/`write` both collapse onto `fileEditing`, importing normalizes back to `edit` (a documented, lossy mapping). The `allowlist.json` file is never deleted. See the [Junie Action Allowlist docs](https://junie.jetbrains.com/docs/action-allowlist-junie-cli.html).

> **Junie-only override (`junie` key):** Junie's `allowlist.json` has two top-level autonomy knobs with no canonical per-glob slot — `allowReadonlyCommands` (a boolean auto-allowing read-only commands) and `defaultBehavior` (the fallback action applied when no rule matches; Junie documents `ask`). Add a tool-scoped `junie` override to author them: its keys are merged onto the top level of `allowlist.json` (the override wins) while the shared `permission` block keeps driving the per-category `rules` groups. On **import**, these keys are lifted from `allowlist.json` into the `junie` override, so they are authorable and portable instead of only round-trip-preserved. Any other unmodeled top-level key is preserved verbatim. Example:
>
> ```json
> {
>   "permission": { "bash": { "git ": "allow" } },
>   "junie": { "allowReadonlyCommands": true, "defaultBehavior": "ask" }
> }
> ```

For Reasonix, this generates `permissions.allow`, `permissions.ask`, and `permissions.deny` arrays in the `[permissions]` table of the shared `reasonix.toml` (project mode) or `~/.reasonix/config.toml` (global mode) — the same TOML file the MCP feature's `[[plugins]]` array-of-tables lives in. The rule syntax mirrors Claude Code's: entries are `Bash(<pattern>)`, `Read(<pattern>)`, `Edit(<pattern>)`, `Write(<pattern>)`, `WebFetch(<pattern>)`, `WebSearch(<pattern>)`, `Grep(<pattern>)`, `Glob(<pattern>)`, `NotebookEdit(<pattern>)`, `Agent(<pattern>)`, etc. (Reasonix's SPEC.md documents these as "Claude Code-style" families; `agent` → `Agent` is the one lower-confidence mapping, since Reasonix's own delegation tool is internally named `task`). `[permissions].mode` (the writer fallback: `ask`/`allow`/`deny`) has no canonical rulesync equivalent and is preserved untouched. The TOML file is shared with the MCP feature, so writes only replace the `permissions` table — every other table (`[[plugins]]`, `[agent]`, `[ui]`, …) is preserved on round-trip, and the file is never deleted. See [SPEC.md §3.7 Permissions](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md).

> **Reasonix-only override (`reasonix` key):** Reasonix has security axes orthogonal to per-tool allow/ask/deny with no canonical category — the `[sandbox]` enforcement table (`workspace_root`, `allow_write`, `forbid_read`, `bash` = `enforce`/`off`, `network`) and the plan-mode read-only trust lists under `[agent]` (`plan_mode_allowed_tools`, `plan_mode_read_only_commands`). Add a tool-scoped `reasonix` override to author them: `reasonix.sandbox` and `reasonix.agent` are shallow-merged into the matching `reasonix.toml` table at its top level (override keys win, unrelated sibling keys such as `[agent].model` are preserved), while the shared `permission` block keeps driving `[permissions].allow`/`ask`/`deny`. On import, the whole `[sandbox]` table round-trips (it is a dedicated security surface) and only the plan-mode keys are lifted from `[agent]`.
>
> ```json
> {
>   "permission": { "bash": { "git status*": "allow" } },
>   "reasonix": {
>     "sandbox": { "bash": "enforce", "network": false },
>     "agent": { "plan_mode_read_only_commands": ["gh pr diff"] }
>   }
> }
> ```
>
> The `[[plugins]].trusted_read_only_tools` MCP read-only trust list is per-plugin (an array-of-tables shared with the MCP feature) and is not covered by this override.

> **Note: Interaction with deprecated ignore feature.** Both the ignore feature and the permissions feature can manage `Read` tool deny entries in `.claude/settings.json`. When both features configure the `Read` tool, the **permissions feature takes precedence** and a warning is emitted. Migrate the ignore patterns to `read` deny rules in `.rulesync/permissions.jsonc`, then remove `ignore` from the project features and delete the obsolete ignore source.
