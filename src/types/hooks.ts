import { nonnegative, z } from "zod/mini";

/**
 * Control characters that must be stripped from command and matcher fields
 * before embedding in generated code.
 */
export const CONTROL_CHARS = ["\n", "\r", "\0"] as const;

/**
 * A string that must not contain newline (\n), carriage return (\r), or NUL (\0) characters.
 * Used for command and matcher fields that are embedded in generated code.
 */
const hasControlChars = (val: string): boolean => CONTROL_CHARS.some((char) => val.includes(char));
export const safeString = z.pipe(
  z.string(),
  z.custom<string>(
    (val) => typeof val === "string" && !hasControlChars(val),
    "must not contain newline, carriage return, or NUL characters",
  ),
);

/**
 * All canonical hook types — the union of the `type` values accepted by every
 * supported tool:
 * - `command` — universal (Claude Code, Codex CLI, Qwen Code, Cursor, …)
 * - `prompt` — Claude Code, Codex CLI, Qwen Code, Copilot CLI, Cursor, Devin
 * - `http` — Claude Code, Qwen Code, Copilot CLI, Grok CLI
 * - `agent` — Claude Code, Codex CLI
 * - `mcp_tool` — Claude Code
 * - `function` — Qwen Code (internal Skill-system executor)
 */
export const HOOK_TYPES = ["command", "prompt", "http", "agent", "mcp_tool", "function"] as const;

/** All canonical hook types. */
export type HookType = (typeof HOOK_TYPES)[number];

/**
 * Canonical hook definition.
 * Used in .rulesync/hooks.jsonc and mapped to tool-specific formats.
 */
export const HookDefinitionSchema = z.looseObject({
  command: z.optional(safeString),
  type: z.optional(z.enum(HOOK_TYPES)),
  // Qwen Code: target URL for `http` hooks (the hook POSTs JSON to this URL).
  // https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
  url: z.optional(safeString),
  timeout: z.optional(z.number()),
  // Kiro CLI caches successful hook results for this many seconds. Zero
  // disables caching; AgentSpawn hooks ignore the setting upstream.
  // https://kiro.dev/docs/cli/hooks/
  cacheTtl: z.optional(z.number().check(nonnegative())),
  matcher: z.optional(safeString),
  // Kiro IDE: whether the hook is active. Kiro writes `enabled` on every hook
  // entry and defaults it to `true`; without a canonical home, importing a
  // deliberately disabled hook and regenerating would silently switch it back
  // on. Only the Kiro IDE emitter reads and writes it.
  // https://kiro.dev/docs/hooks/
  enabled: z.optional(z.boolean()),
  prompt: z.optional(safeString),
  loop_limit: z.optional(z.nullable(z.number())),
  name: z.optional(safeString),
  description: z.optional(safeString),
  // Cursor: when true, a hook failure (crash, timeout, invalid JSON) blocks the
  // action instead of allowing it through. https://cursor.com/docs/hooks
  failClosed: z.optional(z.boolean()),
  // Factory Droid: an extra regex filter applied to the shell command string of
  // an `Execute` matcher group, e.g. `"^git "`. It belongs to the matcher group
  // rather than to a single hook, but is stored per definition so it survives
  // the canonical, flat list of definitions.
  // https://docs.factory.ai/reference/hooks-reference
  commandRegex: z.optional(safeString),
  // Qwen Code: when true, the hooks within this matcher group run sequentially
  // instead of in parallel (the default). Stored per-definition so it can be
  // round-tripped through the canonical, flat list of definitions.
  // https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
  sequential: z.optional(z.boolean()),
  // Qwen Code per-hook fields (PR https://github.com/QwenLM/qwen-code/pull/2827).
  // Command hooks: `async` runs the command in the background without blocking;
  // `env` supplies extra environment variables to the subprocess; `shell`
  // selects the interpreter (`"bash"` | `"powershell"`).
  async: z.optional(z.boolean()),
  // Map/string values use `safeString` so control characters (newline/CR/NUL)
  // can't ride into a generated shell env var or HTTP header (header-splitting
  // shape), consistent with how `command`/`url` are guarded.
  env: z.optional(z.record(z.string(), safeString)),
  // Only Claude Code and Qwen Code expose an interpreter selector, and both
  // restrict it to the same two values, so the field is a closed enum.
  // https://code.claude.com/docs/en/hooks
  shell: z.optional(z.enum(["bash", "powershell"])),
  // `statusMessage` is the progress text shown while the hook runs; Qwen Code
  // accepts it on both command and http hooks.
  statusMessage: z.optional(safeString),
  // HTTP hooks: `headers` sets request headers (with `${VAR}` interpolation);
  // `allowedEnvVars` whitelists the env vars usable in URL/headers; `once`
  // limits execution to a single invocation per event per session.
  // https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
  headers: z.optional(z.record(z.string(), safeString)),
  allowedEnvVars: z.optional(z.array(z.string())),
  once: z.optional(z.boolean()),
  // Claude Code `mcp_tool` hooks: `server` names a configured MCP server,
  // `tool` the tool to call on it, and `input` the (arbitrary JSON) arguments
  // passed to the tool, whose string values support `${path}` substitution.
  // https://code.claude.com/docs/en/hooks
  server: z.optional(safeString),
  tool: z.optional(safeString),
  input: z.optional(z.looseObject({})),
  // Claude Code `prompt` and `agent` hooks: the model used for evaluation
  // (defaults to a fast model when omitted). Also forwarded to Qwen Code
  // prompt hooks.
  model: z.optional(safeString),
  // AugmentCode command hooks: extra argv appended to `command` by the runner,
  // so a hook can pass arguments without quoting them into the command string.
  // Accepted by the shipped CLI's validator (`@augmentcode/auggie` 0.33.0),
  // though the docs page does not list it.
  args: z.optional(z.array(safeString)),
  // AugmentCode matcher-group options selecting what the runner puts in the
  // JSON payload the hook script receives (`includeConversationData`,
  // `includeMCPMetadata`, `includeUserContext`). Group-level upstream; stored
  // per definition here, like `sequential`, since the canonical model is a flat
  // list. https://docs.augmentcode.com/cli/hooks
  metadata: z.optional(z.looseObject({})),
  // Claude Code tool events (PreToolUse/PostToolUse/PostToolUseFailure/
  // PermissionRequest/PermissionDenied): `if` filters a hook by tool arguments,
  // holding a single permission rule with the same syntax as settings.json
  // permission rules (e.g. `"Bash(rm *)"`). Claude Code has no combining
  // (`&&`/`||`/list) syntax, so it round-trips as an opaque string.
  // https://code.claude.com/docs/en/hooks
  if: z.optional(safeString),
  // Codex CLI command hooks: a Windows-only override for `command`, so one hook
  // set can be cross-platform. Added in Codex CLI 0.131.0 (PR #22159); spelled
  // `command_windows` in the inline TOML `[hooks]` form and `commandWindows` in
  // `.codex/hooks.json`, which is the file rulesync writes.
  // https://learn.chatgpt.com/docs/hooks
  commandWindows: z.optional(safeString),
  // Codex CLI command hooks: the token threshold above which Codex writes the
  // hook's additional context to a file and passes the path instead of the
  // text itself. Defaults to 2500 upstream. Constrained to a non-negative
  // integer because a token count is one: a fractional or negative value would
  // be emitted verbatim and could make Codex reject the whole hooks file.
  // https://learn.chatgpt.com/docs/hooks
  additionalContextLimit: z.optional(z.int().check(nonnegative())),
  // Claude Code command hooks: `asyncRewake` runs the hook in the background
  // and wakes Claude on exit code 2 (it implies `async`).
  // https://code.claude.com/docs/en/hooks
  asyncRewake: z.optional(z.boolean()),
  // Claude Code: feed a blocking hook's rejection reason back to the model and
  // continue the turn instead of ending it. Added for `PostToolUse` in 2.1.139.
  // https://code.claude.com/docs/en/hooks
  continueOnBlock: z.optional(z.boolean()),
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

/**
 * All canonical hook event names.
 * Each tool supports a subset of these events.
 */
export const HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "preModelInvocation",
  "postModelInvocation",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "postCompact",
  "contextOffload",
  "postToolUseFailure",
  "subagentStart",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "beforeAgentResponse",
  "afterAgentResponse",
  "afterAgentThought",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "permissionRequest",
  "notification",
  "setup",
  "afterError",
  "beforeToolSelection",
  "worktreeCreate",
  "worktreeRemove",
  "workspaceOpen",
  "messageDisplay",
  "todoCreated",
  "todoCompleted",
  "stopFailure",
  "instructionsLoaded",
  "userPromptExpansion",
  "postToolBatch",
  "permissionDenied",
  "taskCreated",
  "taskCompleted",
  "teammateIdle",
  "configChange",
  "cwdChanged",
  "fileChanged",
  "directoryAdded",
  "elicitation",
  "elicitationResult",
  "sessionDelete",
] as const;

/** All canonical hook event names. */
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Hook events supported by Cursor. */
export const CURSOR_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "postToolUseFailure",
  "subagentStart",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "afterAgentResponse",
  "afterAgentThought",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "workspaceOpen",
];

/**
 * Hook events supported by Claude Code.
 *
 * Covers the full documented event surface.
 * @see https://code.claude.com/docs/en/hooks#hook-events
 */
export const CLAUDE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "permissionRequest",
  "notification",
  "setup",
  "worktreeCreate",
  "worktreeRemove",
  "messageDisplay",
  // Added to follow the current documented event surface.
  "instructionsLoaded",
  "userPromptExpansion",
  "postToolUseFailure",
  "postToolBatch",
  "permissionDenied",
  "subagentStart",
  "taskCreated",
  "taskCompleted",
  "stopFailure",
  "teammateIdle",
  "configChange",
  "cwdChanged",
  "fileChanged",
  // Fires after `/add-dir` or the SDK `register_repo_root` control request
  // registers a new working directory mid-session. The matcher filters on how
  // the directory was added (`slash_command`, `register_repo_root`).
  // https://code.claude.com/docs/en/hooks
  "directoryAdded",
  "postCompact",
  "elicitation",
  "elicitationResult",
];

/**
 * Hook events supported by Devin Local (native `.devin/` hooks).
 *
 * Devin Local adopts a Claude-Code-style lifecycle hooks surface. It documents
 * eight events: `PreToolUse`, `PostToolUse`, `PermissionRequest`,
 * `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, and
 * `PostCompaction` (fires after context compaction; added in the Devin CLI
 * stable changelog — https://docs.devin.ai/cli/changelog/stable). The
 * tool/permission events (`PreToolUse`/`PostToolUse`/`PermissionRequest`) carry
 * a `matcher` (regex against `tool_name`); the session/turn/compaction events
 * do not.
 *
 * Hooks live in `.devin/hooks.v1.json` (project, standalone — the hooks object
 * is the entire file) or under the `"hooks"` key of `.devin/config.json` /
 * `~/.config/devin/config.json`.
 *
 * @see https://docs.devin.ai/cli/extensibility/hooks/overview
 */
export const DEVIN_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "permissionRequest",
  "postCompact",
];

/**
 * Hook events supported by OpenCode.
 *
 * `preCompact` maps to `experimental.session.compacting` and
 * `beforeSubmitPrompt` to `chat.message`, both of which the plugin docs
 * document as named `(input, output)` hooks rather than `event.type`
 * dispatches; the other entries are all generic events.
 *
 * @see https://opencode.ai/docs/plugins/
 */
export const OPENCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "stop",
  "afterFileEdit",
  "beforeShellExecution",
  "afterShellExecution",
  "permissionRequest",
  "preCompact",
  "postCompact",
  "afterError",
  "fileChanged",
  "notification",
  "permissionDenied",
  "beforeSubmitPrompt",
];

/**
 * Hook events supported by Kilo. Kilo's plugin docs list the same event surface
 * as OpenCode's — including `session.compacted`, `session.error`,
 * `file.watcher.updated`, `permission.replied`, `chat.message` and the
 * experimental compaction hook — with one exception: they document no TUI
 * events at all, so `tui.toast.show` (canonical `notification`) is left out
 * rather than emitted into a plugin where it may never fire.
 *
 * @see https://kilo.ai/docs/automate/extending/plugins
 */
export const KILO_HOOK_EVENTS: readonly HookEvent[] = OPENCODE_HOOK_EVENTS.filter(
  (event) => event !== "notification",
);

/**
 * Hook events supported by Pi Coding Agent, bridged through a generated
 * TypeScript extension (Pi has no static hook config file; its extension API
 * exposes lifecycle events instead).
 *
 * Only canonical events with a semantically faithful Pi extension event are
 * listed; see CANONICAL_TO_PI_EVENT_NAMES for the mapping.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
 */
export const PI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "preModelInvocation",
  "postModelInvocation",
  "beforeSubmitPrompt",
  "stop",
  "preCompact",
  "postCompact",
];

/**
 * Hook events supported by Amp through its generated TypeScript Plugin API
 * adapter. Amp's `agent.start` / `agent.end` events describe the main agent
 * turn, not a subagent lifecycle, so they map to `beforeSubmitPrompt` / `stop`.
 *
 * @see https://ampcode.com/manual/plugin-api
 */
export const AMP_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
];

/**
 * Hook events supported by Cline's file-based hooks. Cline resolves one
 * executable per lifecycle event from its hooks directory, and the accepted
 * event names come from two runtimes that read the same directory:
 *
 * - The VS Code extension fixes them in `VALID_HOOK_TYPES`
 *   (`apps/vscode/src/core/hooks/utils.ts`): `TaskStart`, `TaskResume`,
 *   `TaskCancel`, `TaskComplete`, `PreToolUse`, `PostToolUse`,
 *   `UserPromptSubmit`, `Notification` and `PreCompact`.
 * - The SDK/CLI fixes them in `HookConfigFileName`
 *   (`sdk/packages/core/src/hooks/hook-file-config.ts`), which drops
 *   `Notification` but adds `TaskError` (→ `agent_error`) and
 *   `SessionShutdown` (→ `session_shutdown`).
 *
 * This set is the union, because `.clinerules/hooks` is in both runtimes'
 * search paths and a script named for an event the running one does not know
 * is simply never spawned. That holds for unknown *names* only: for an event a
 * runtime does know, the SDK/CLI spawns both the extensionless script and its
 * `.ps1` twin, so each generated script opens with a guard that stands down on
 * the platform the other one owns — see `generateClineHookScript` and
 * `generateClineHookPowerShellScript`.
 *
 * `TaskResume` and `TaskCancel` have no canonical counterpart and stay
 * unmapped rather than being approximated by `sessionEnd` / `stop`, whose
 * semantics differ.
 *
 * @see https://github.com/cline/cline/blob/main/apps/vscode/src/core/hooks/utils.ts
 * @see https://github.com/cline/cline/blob/main/sdk/packages/core/src/hooks/hook-file-config.ts
 */
export const CLINE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "preCompact",
  "notification",
  "taskCompleted",
  "afterError",
];

/**
 * Hook events supported by GitHub Copilot (cloud coding agent).
 *
 * The events rulesync writes to `.github/hooks/*.json`:
 * `sessionStart`, `sessionEnd`, `userPromptSubmitted` ← `beforeSubmitPrompt`,
 * `preToolUse`, `postToolUse`, `postToolUseFailure`, `agentStop` ← `stop`,
 * `subagentStart`, `subagentStop`, `errorOccurred` ← `afterError`,
 * `preCompact`, and `userPromptTransformed` ← `userPromptExpansion`.
 *
 * `preCompact` and `subagentStart` are authorable because the unified hooks
 * reference's per-event "Cloud agent" column says both fire there. That column
 * is the authority for this set: the older cloud-agent concept page still
 * lists only the eight events this set began as, and re-narrowing to it would
 * undo that. `notification` and `permissionRequest` stay out because the same
 * column is explicit that they do not fire on the cloud agent.
 *
 * `postToolUseFailure` and `userPromptTransformed` are shared with
 * {@link COPILOTCLI_HOOK_EVENTS}; the same column records both as firing on the
 * cloud agent, so they are authorable here too. The event surfaces overlap but
 * the config surfaces do not: `copilot` emits `command` hooks only, while the
 * CLI adapter also handles `http` and `prompt`.
 *
 * @see https://docs.github.com/en/copilot/reference/hooks-reference
 */
export const COPILOT_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "stop",
  "subagentStart",
  "subagentStop",
  "afterError",
  "preCompact",
  "userPromptExpansion",
];

/**
 * Hook events supported by the GitHub Copilot CLI (`copilotcli-hooks.ts`).
 *
 * The CLI documents a wider event surface than the shared cloud-agent set, so
 * `copilotcli` diverges from {@link COPILOT_HOOK_EVENTS}. Full documented set:
 * `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`,
 * `postToolUse`, `postToolUseFailure`, `agentStop`, `subagentStart`,
 * `subagentStop`, `errorOccurred`, `preCompact`, `permissionRequest`,
 * `notification`, `userPromptTransformed` ← `userPromptExpansion`,
 * `preMcpToolCall` ← `beforeMCPExecution`.
 *
 * `preMcpToolCall` (canonical `beforeMCPExecution`) was added in Copilot CLI
 * v1.0.51 (2026-05-20) for hook providers to control outgoing MCP request
 * metadata. https://github.com/github/copilot-cli/blob/main/changelog.md
 *
 * @see https://docs.github.com/en/copilot/reference/hooks-configuration
 */
export const COPILOTCLI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "stop",
  "subagentStart",
  "subagentStop",
  "afterError",
  "preCompact",
  "permissionRequest",
  "notification",
  // Copilot CLI's `userPromptTransformed` — a mutation-only hook that runs on
  // the transformed prompt and can rewrite the model-facing content. Same
  // concept as Qwen Code's `UserPromptExpansion`, so it reuses the existing
  // canonical `userPromptExpansion` event rather than adding a new one.
  "userPromptExpansion",
  "beforeMCPExecution",
];

/**
 * Hook events supported by Factory Droid.
 *
 * Matches the documented 9-event set (PreToolUse, PostToolUse, UserPromptSubmit,
 * Notification, Stop, SubagentStop, PreCompact, SessionStart, SessionEnd).
 * `Setup` and `PermissionRequest` are NOT valid Droid events and were removed
 * to avoid emitting dead keys. https://docs.factory.ai/reference/hooks-reference
 */
export const FACTORYDROID_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "notification",
];

/**
 * Hook events supported by deepagents-cli (`deepagents-code` / `dcode`).
 *
 * These are the twelve Hooks v2 `HookEvent` members, GA since deepagents-code
 * 0.1.52. Canonical `contextOffload` is deliberately absent — see
 * {@link CANONICAL_TO_DEEPAGENTS_EVENT_NAMES}.
 * https://docs.langchain.com/oss/python/deepagents/cli/configuration
 */
export const DEEPAGENTS_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "permissionRequest",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "stop",
  "preCompact",
  "notification",
  "subagentStart",
  "subagentStop",
];

/** Hook events supported by Codex CLI. */
export const CODEXCLI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  // Added in Codex CLI 0.145.0 (PR #33895). Its matcher is the end reason and
  // its timeout is capped at 3s, but neither is modelled differently here:
  // the matcher is already a free string and the timeout is the tool's to
  // enforce. https://github.com/openai/codex/releases/tag/rust-v0.145.0
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "permissionRequest",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
];

/**
 * Hook events supported by Goose.
 *
 * Goose adopts the Open Plugins hooks spec: each plugin's `hooks/hooks.json`
 * maps PascalCase event names to matcher/handler arrays. Every Goose event has a
 * 1:1 canonical equivalent, so no new canonical events are required.
 *
 * Goose's `HookEvent` enum defines exactly these 11 events (v1.41.0). Notably it
 * has NO `SubagentStart`/`SubagentStop` arms — emitting them would write keys
 * Goose silently ignores, so `subagentStart`/`subagentStop` are intentionally
 * excluded here and from `CANONICAL_TO_GOOSE_EVENT_NAMES`.
 * @see https://github.com/aaif-goose/goose/blob/v1.41.0/crates/goose/src/hooks/mod.rs
 * @see https://goose-docs.ai/docs/guides/context-engineering/hooks/
 */
export const GOOSE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "stop",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeReadFile",
  "afterFileEdit",
  "beforeShellExecution",
  "afterShellExecution",
];

/**
 * Hook events supported by the embedded agent-config hook format, which only
 * the deprecated `kiro` alias still writes. See {@link KIRO_IDE_HOOK_EVENTS}
 * for the standalone format both Kiro products read today.
 */
export const KIRO_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "stop",
];

/**
 * Hook events supported by Kiro's standalone hooks format
 * (`.kiro/hooks/*.json` v1), which the Kiro IDE and Kiro CLI 3.0 both read.
 *
 * Kiro exposes PascalCase triggers. rulesync maps the canonical lifecycle
 * events that have a clean 1:1 equivalent: `SessionStart`, `Stop`,
 * `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`. Kiro also documents
 * file-event (`PostFileCreate`/`PostFileSave`/`PostFileDelete`) and spec-task
 * (`PreTaskExec`/`PostTaskExec`) triggers that have no canonical equivalent;
 * those can still be emitted verbatim via the shared `kiro` override block
 * (unknown event keys pass through unchanged). There is no `SessionEnd`
 * trigger, so the canonical `sessionEnd` has no home here.
 * @see https://kiro.dev/docs/hooks/types/
 */
export const KIRO_IDE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "stop",
];

/**
 * Hook events supported by Google Antigravity (both the IDE and the CLI).
 *
 * Antigravity exposes a Claude-style hooks surface covering the five
 * tool/model/turn lifecycle events it documents: `PreToolUse`, `PostToolUse`,
 * `PreInvocation`, `PostInvocation`, and `Stop`. The model-invocation events
 * (`PreInvocation`/`PostInvocation`) and `Stop` are matcher-less handler lists.
 */
export const ANTIGRAVITY_HOOK_EVENTS: readonly HookEvent[] = [
  "preToolUse",
  "postToolUse",
  "preModelInvocation",
  "postModelInvocation",
  "stop",
];

/**
 * Hook events supported by AugmentCode (Auggie CLI).
 * Auggie mirrors Claude Code's lifecycle hooks but exposes a smaller set:
 * PreToolUse / PostToolUse (tool events, matcher-aware) plus the
 * SessionStart / SessionEnd / Stop / Notification session events (no matcher).
 * @see https://docs.augmentcode.com/cli/hooks
 */
export const AUGMENTCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "preToolUse",
  "postToolUse",
  "sessionStart",
  "sessionEnd",
  "stop",
  "notification",
  // `PromptSubmit`, added in auggie 0.27.0 (2026-05-14).
  // https://www.augmentcode.com/changelog/auggie-cli-0-27-0-release-notes
  "beforeSubmitPrompt",
];

/**
 * Hook events supported by Mistral Vibe (mistral-vibe).
 *
 * Vibe exposes three hook events in `.vibe/hooks.toml`: `pre_tool` ←
 * `preToolUse`, `post_tool` ← `postToolUse`, and `post_agent` ← `stop` (fires
 * after every assistant turn that ends without pending tool calls — the closest
 * canonical equivalent to a "turn end"/"stop" event, matching how
 * codexcli/copilot map their stop events). Only the tool events
 * (`pre_tool`/`post_tool`) carry the `match` tool-name matcher (fnmatch glob or
 * `re:` regex) and the `strict` flag; `post_agent` carries neither. Only
 * `type: "command"` hooks are relevant.
 *
 * v2.21.0 graduated hooks from experimental and renamed all three types
 * (`before_tool` → `pre_tool`, `after_tool` → `post_tool`, `post_agent_turn` →
 * `post_agent`). `HookType` is a strict enum, so an entry using an old name is
 * rejected outright and reported as a `HookConfigIssue`.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
export const VIBE_HOOK_EVENTS: readonly HookEvent[] = ["preToolUse", "postToolUse", "stop"];

/**
 * Hook events supported by JetBrains Junie CLI.
 *
 * Junie CLI exposes seven lifecycle events under the `"hooks"` key of
 * `~/.junie/config.json`: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
 * `Stop`, `StopFailure`, `PermissionRequest`, and `SessionEnd`. Matchers apply
 * to `SessionStart` (source), `PreToolUse` (tool name), `StopFailure` (error
 * type), `PermissionRequest` (tool name), and `SessionEnd` (reason);
 * `UserPromptSubmit` and `Stop` are matcher-less and always run. Only
 * `type: "command"` hooks are supported. Project-local hooks are ignored for
 * safety.
 * @see https://junie.jetbrains.com/docs/junie-cli-hooks.html
 */
export const JUNIE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "stop",
  "stopFailure",
  "permissionRequest",
  "sessionEnd",
];

/**
 * Hook events supported by Qwen Code.
 *
 * Qwen Code documents a Claude-style PascalCase hooks surface under the `hooks`
 * key of `.qwen/settings.json`. Its event set differs from the Gemini-lineage
 * set (`BeforeAgent`/`AfterTool`/...), so qwencode defines its own constant.
 * The Qwen-specific events
 * `TodoCreated`, `TodoCompleted`, and `StopFailure` map to the canonical
 * `todoCreated`, `todoCompleted`, and `stopFailure` events respectively.
 * Qwen's `HookEventName` enum (`packages/core/src/hooks/types.ts`) also documents
 * `PostToolBatch`, `UserPromptExpansion`, `PermissionDenied`, and
 * `InstructionsLoaded`, which map to the canonical `postToolBatch`,
 * `userPromptExpansion`, `permissionDenied`, and `instructionsLoaded` events.
 * @see https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
 */
export const QWENCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "postToolBatch",
  "beforeSubmitPrompt",
  "userPromptExpansion",
  "stop",
  "stopFailure",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
  "permissionRequest",
  "permissionDenied",
  "notification",
  "instructionsLoaded",
  "todoCreated",
  "todoCompleted",
  // `hooks.MessageDisplay` landed in Qwen Code v0.19.10 (PR #6489): fires
  // repeatedly as the reply streams (payload message_id/displayed_text/is_final).
  "messageDisplay",
  // `hooks.SessionDelete` landed in Qwen Code v0.21.3 (PR #8059): fires after an
  // explicitly selected session is deleted (interactive `/delete` and the ACP
  // `deleteSession` request). It has no matcher support.
  "sessionDelete",
];

/**
 * Hook events supported by Reasonix.
 *
 * Reasonix's `.reasonix/settings.json` (project) / `~/.reasonix/settings.json`
 * (global) documents a ten-event surface (`PreToolUse`, `PostToolUse`,
 * `UserPromptSubmit`, `Stop`, `PostLLMCall`, `SessionStart`, `SessionEnd`,
 * `SubagentStop`, `Notification`, `PreCompact`). All ten have a clean canonical
 * equivalent and are mapped: `PreToolUse`, `PostToolUse`,
 * `UserPromptSubmit` ← `beforeSubmitPrompt`, `Stop`, `SessionStart`,
 * `SessionEnd`, `SubagentStop`, `PostLLMCall` ← `postModelInvocation`,
 * `Notification` ← `notification`, and `PreCompact` ← `preCompact`.
 * `match` (Reasonix's matcher field name) is honored only on
 * `PreToolUse`/`PostToolUse`, matching the canonical `matcher` field's
 * tool-event scoping used by other adapters.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
export const REASONIX_HOOK_EVENTS: readonly HookEvent[] = [
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "sessionStart",
  "sessionEnd",
  "subagentStop",
  "postModelInvocation",
  "notification",
  "preCompact",
];

/**
 * Hook events supported by Grok CLI (xAI Grok Build).
 *
 * Grok Build documents a Claude-Code-compatible hooks surface with fourteen
 * PascalCase events, all of which map 1:1 onto an existing canonical arm:
 * `SessionStart`, `SessionEnd`, `UserPromptSubmit` ← `beforeSubmitPrompt`,
 * `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`,
 * `Stop`, `StopFailure`, `Notification`, `SubagentStart`, `SubagentStop`,
 * `PreCompact`, `PostCompact`. A `matcher` (a regex tested against the tool
 * name) is meaningful only on the tool-name events (`PreToolUse`, `PostToolUse`,
 * `PostToolUseFailure`, `PermissionDenied`), matching Claude Code's semantics;
 * the remaining lifecycle events are matcher-less.
 * @see https://docs.x.ai/build/features/hooks
 */
export const GROKCLI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "permissionDenied",
  "stop",
  "stopFailure",
  "notification",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
];

/**
 * Hook events supported by Kimi Code.
 *
 * Kimi Code also exposes `PermissionResult`, `Interrupt`, and the four events
 * added in 0.32.0 (`TurnStarted`, `UserPromptQueued`, `TaskStarted`,
 * `SessionHeartbeat`), none of which have a canonical rulesync event. They are
 * listed in `KIMI_CODE_NATIVE_HOOK_EVENTS` so a per-tool `kimi-code` override
 * can address them by their native name.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/hooks.html
 */
export const KIMI_CODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "permissionRequest",
  "stop",
  "stopFailure",
  "notification",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
];

export const CANONICAL_TO_KIMI_CODE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  permissionRequest: "PermissionRequest",
  stop: "Stop",
  stopFailure: "StopFailure",
  notification: "Notification",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
};

/**
 * Every event name Kimi Code accepts in a `[[hooks]]` entry: the ones with a
 * canonical rulesync counterpart plus the native-only ones, which are reachable
 * through a per-tool `kimi-code` override that names them directly.
 *
 * `TurnStarted`, `UserPromptQueued`, `TaskStarted`, and `SessionHeartbeat` were
 * added in Kimi Code 0.32.0. They stay native-only: `TaskStarted` fires when a
 * background task starts and matches on task kind, whereas the canonical
 * `taskCreated` models Claude Code's blocking, matcher-less `TaskCreated`
 * (fired while a task is being created), so the two are not interchangeable.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/hooks.html
 */
export const KIMI_CODE_NATIVE_HOOK_EVENTS = [
  ...Object.values(CANONICAL_TO_KIMI_CODE_EVENT_NAMES),
  "PermissionResult",
  "Interrupt",
  "TurnStarted",
  "UserPromptQueued",
  "TaskStarted",
  "SessionHeartbeat",
] as const;

export const KIMI_CODE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_KIMI_CODE_EVENT_NAMES).map(([canonical, kimiCode]) => [
    kimiCode,
    canonical,
  ]),
);

/**
 * Hook events supported by Hermes Agent's native Shell Hooks system.
 *
 * Hermes validates hook events against a fixed `VALID_HOOKS` set — 37 entries as
 * of v0.20.2 (`v2026.8.16`); see {@link HERMESAGENT_NATIVE_HOOK_EVENTS} for the
 * full list. Only the events with a clean 1:1 canonical equivalent are mapped
 * here. All other native events round-trip through `hermesagent.hooks`.
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md
 */
export const HERMESAGENT_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "preModelInvocation",
  "postModelInvocation",
  "subagentStart",
  "subagentStop",
];

/**
 * Hermes Agent's native `VALID_HOOKS` set, in upstream source order.
 *
 * The authority is `hermes_cli/plugins.py`'s `VALID_HOOKS`, not the docs: at
 * v0.20.2 `website/docs/user-guide/features/plugins.md` says "26 lifecycle
 * events" and then lists 30, omitting the five `on_kanban_*` worker/task/dispatch
 * observers, `gateway_platform_event` and `transform_api_error_classification`.
 * Shell hooks are gated on the same set.
 *
 * Verified against the tag `v2026.8.16` (v0.20.2): 37 entries, grown from 23 at
 * `v2026.8.3` (v0.20.0).
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/v2026.8.16/hermes_cli/plugins.py
 */
export const HERMESAGENT_NATIVE_HOOK_EVENTS = [
  "pre_tool_call",
  "post_tool_call",
  "transform_terminal_output",
  "transform_tool_result",
  "transform_llm_output",
  "pre_llm_call",
  "post_llm_call",
  "on_stream_start",
  "on_stream_delta",
  "on_stream_end",
  "on_interim_message",
  "pre_verify",
  "pre_api_request",
  "post_api_request",
  "api_request_error",
  "transform_api_error_classification",
  "on_session_start",
  "on_session_end",
  "on_session_finalize",
  "on_session_reset",
  "on_skill_lifecycle",
  "subagent_start",
  "subagent_stop",
  "pre_gateway_dispatch",
  "pre_approval_request",
  "post_approval_response",
  "pre_transcription",
  "kanban_task_claimed",
  "kanban_task_completed",
  "kanban_task_blocked",
  "on_kanban_worker_spawned",
  "on_kanban_worker_exited",
  "on_kanban_worker_stale_claim",
  "on_kanban_task_updated",
  "on_kanban_dispatch_tick",
  "gateway_platform_event",
  "pre_command",
] as const;

/**
 * Map canonical camelCase event names to Hermes Agent's native `VALID_HOOKS`
 * snake_case keys under the `hooks:` block of `~/.hermes/config.yaml`.
 */
export const CANONICAL_TO_HERMESAGENT_EVENT_NAMES: Record<string, string> = {
  sessionStart: "on_session_start",
  sessionEnd: "on_session_end",
  preToolUse: "pre_tool_call",
  postToolUse: "post_tool_call",
  preModelInvocation: "pre_llm_call",
  postModelInvocation: "post_llm_call",
  subagentStart: "subagent_start",
  subagentStop: "subagent_stop",
};

/**
 * Map Hermes Agent's native `VALID_HOOKS` keys back to canonical camelCase.
 */
export const HERMESAGENT_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_HERMESAGENT_EVENT_NAMES).map(([k, v]) => [v, k]),
);

const hooksRecordSchema = z.record(z.string(), z.array(HookDefinitionSchema));

const HOOK_EVENT_SET: ReadonlySet<string> = new Set(HOOK_EVENTS);

/** Whether `value` is a canonical hook event name. */
export const isHookEvent = (value: string): value is HookEvent => HOOK_EVENT_SET.has(value);

/**
 * Top-level `hooks` record whose keys must be canonical event names, so typos
 * are rejected at parse time. Keys are validated with a refinement (instead of
 * an enum key schema) to keep the inferred type a plain string record.
 *
 * The per-tool override blocks below deliberately keep the lenient
 * `hooksRecordSchema`: some are documented to pass tool-native event keys
 * through verbatim (e.g. kiro-ide's IDE-only `PostFileSave`/`PreTaskExec`
 * triggers), which the canonical enum would reject.
 */
const canonicalHooksRecordSchema = z.record(z.string(), z.array(HookDefinitionSchema)).check(
  z.refine((record) => Object.keys(record).every((key) => HOOK_EVENT_SET.has(key)), {
    error: (issue) => {
      const keys = Object.keys((issue.input as Record<string, unknown>) ?? {});
      const unknown = keys.filter((key) => !HOOK_EVENT_SET.has(key));
      return `unknown hook event name(s): ${unknown.join(", ")}`;
    },
  }),
);

/**
 * Canonical hooks config (canonical event names in camelCase).
 */
export const HooksConfigSchema = z.looseObject({
  version: z.optional(z.number()),
  hooks: canonicalHooksRecordSchema,
  cursor: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  claudecode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  copilot: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  copilotcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  opencode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  kilo: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  pi: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  amp: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  factorydroid: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  codexcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  goose: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  deepagents: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  kiro: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "kiro-cli": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "kiro-ide": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  devin: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  augmentcode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "antigravity-ide": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "antigravity-cli": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  hermesagent: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  junie: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  vibe: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  reasonix: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  grokcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "kimi-code": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  qwencode: z.optional(
    z.looseObject({
      hooks: z.optional(hooksRecordSchema),
      // Qwen Code top-level switch that disables every hook when true.
      disableAllHooks: z.optional(z.boolean()),
    }),
  ),
});

export type HooksConfig = z.infer<typeof HooksConfigSchema>;

/**
 * Map canonical camelCase event names to Claude PascalCase.
 */
export const CANONICAL_TO_CLAUDE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  setup: "Setup",
  worktreeCreate: "WorktreeCreate",
  worktreeRemove: "WorktreeRemove",
  messageDisplay: "MessageDisplay",
  instructionsLoaded: "InstructionsLoaded",
  userPromptExpansion: "UserPromptExpansion",
  postToolUseFailure: "PostToolUseFailure",
  postToolBatch: "PostToolBatch",
  permissionDenied: "PermissionDenied",
  subagentStart: "SubagentStart",
  taskCreated: "TaskCreated",
  taskCompleted: "TaskCompleted",
  stopFailure: "StopFailure",
  teammateIdle: "TeammateIdle",
  configChange: "ConfigChange",
  cwdChanged: "CwdChanged",
  fileChanged: "FileChanged",
  directoryAdded: "DirectoryAdded",
  postCompact: "PostCompact",
  elicitation: "Elicitation",
  elicitationResult: "ElicitationResult",
};

/**
 * Map Claude PascalCase event names to canonical camelCase.
 */
export const CLAUDE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Devin Local PascalCase.
 *
 * Devin Local reuses the same Claude-style PascalCase event names for the
 * subset of events it supports.
 * @see https://docs.devin.ai/cli/extensibility/hooks/overview
 */
export const CANONICAL_TO_DEVIN_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  permissionRequest: "PermissionRequest",
  // Devin's post-context-compaction event uses the `PostCompaction` PascalCase
  // key (not `PostCompact`). https://docs.devin.ai/cli/changelog/stable
  postCompact: "PostCompaction",
};

/**
 * Map Devin Local PascalCase event names to canonical camelCase.
 */
export const DEVIN_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_DEVIN_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to AugmentCode PascalCase.
 * Auggie reuses the same PascalCase names as Claude for the events it supports.
 */
export const CANONICAL_TO_AUGMENTCODE_EVENT_NAMES: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  stop: "Stop",
  notification: "Notification",
  beforeSubmitPrompt: "PromptSubmit",
};

/**
 * Map AugmentCode PascalCase event names to canonical camelCase.
 */
export const AUGMENTCODE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_AUGMENTCODE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Antigravity PascalCase.
 * Antigravity uses the same PascalCase names as Claude for its tool/turn events,
 * plus `PreInvocation`/`PostInvocation` for the model-invocation lifecycle.
 */
export const CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  preModelInvocation: "PreInvocation",
  postModelInvocation: "PostInvocation",
  stop: "Stop",
};

/**
 * Map Antigravity PascalCase event names to canonical camelCase.
 */
export const ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Cursor camelCase.
 * Currently 1:1 but kept explicit so divergences are easy to add.
 */
export const CANONICAL_TO_CURSOR_EVENT_NAMES: Record<string, string> = {
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  beforeSubmitPrompt: "beforeSubmitPrompt",
  stop: "stop",
  subagentStop: "subagentStop",
  preCompact: "preCompact",
  postToolUseFailure: "postToolUseFailure",
  subagentStart: "subagentStart",
  beforeShellExecution: "beforeShellExecution",
  afterShellExecution: "afterShellExecution",
  beforeMCPExecution: "beforeMCPExecution",
  afterMCPExecution: "afterMCPExecution",
  beforeReadFile: "beforeReadFile",
  afterFileEdit: "afterFileEdit",
  afterAgentResponse: "afterAgentResponse",
  afterAgentThought: "afterAgentThought",
  beforeTabFileRead: "beforeTabFileRead",
  afterTabFileEdit: "afterTabFileEdit",
  workspaceOpen: "workspaceOpen",
};

/**
 * Map Cursor camelCase event names to canonical camelCase.
 */
export const CURSOR_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CURSOR_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Factory Droid PascalCase.
 */
export const CANONICAL_TO_FACTORYDROID_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  notification: "Notification",
};

/**
 * Map Factory Droid PascalCase event names to canonical camelCase.
 */
export const FACTORYDROID_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_FACTORYDROID_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to OpenCode dot-notation.
 */
export const CANONICAL_TO_OPENCODE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session.created",
  preToolUse: "tool.execute.before",
  postToolUse: "tool.execute.after",
  stop: "session.idle",
  afterFileEdit: "file.edited",
  // The shell events are NOT in this map: OpenCode has no shell-execution
  // lifecycle event (`command.executed` is a slash-command event), so they are
  // emitted as `tool.execute.before/after` named hooks gated on the `bash`
  // tool — see `SHELL_EVENT_TOOL_GATES` in `opencode-style-generator.ts`.
  permissionRequest: "permission.asked",
  // `permission.replied` fires for every reply, so the generated handler gates
  // on a rejecting reply — see `GENERIC_EVENT_PROPERTY_GATES` in
  // `opencode-style-generator.ts`.
  permissionDenied: "permission.replied",
  notification: "tui.toast.show",
  // Named `(input, output)` hooks, not `event.type` dispatches — see
  // `NAMED_HOOK_MATCHER_SUBJECTS` in `opencode-style-generator.ts`.
  preCompact: "experimental.session.compacting",
  beforeSubmitPrompt: "chat.message",
  postCompact: "session.compacted",
  afterError: "session.error",
  fileChanged: "file.watcher.updated",
};

/**
 * Map canonical camelCase event names to Kilo dot-notation.
 *
 * Shared with OpenCode: the two name the same events. The `notification` entry
 * is unreachable for Kilo because `KILO_HOOK_EVENTS` omits it, and the
 * generator emits only supported events.
 */
export const CANONICAL_TO_KILO_EVENT_NAMES: Record<string, string> =
  CANONICAL_TO_OPENCODE_EVENT_NAMES;

/**
 * Map canonical camelCase event names to Pi Coding Agent extension event
 * names (snake_case).
 *
 * Mapping notes: `sessionEnd` → `session_shutdown` (fires on session
 * teardown), `beforeSubmitPrompt` → `input` (user input interception),
 * `preModelInvocation` → `context` (fires before each LLM call), and
 * `stop` → `agent_end` (agent finished responding; unlike Claude Code's
 * Stop, this also fires before Pi auto-retries or auto-compacts —
 * `agent_settled` would skip queued follow-ups instead, a pure trade-off).
 * Pi events without a faithful canonical counterpart (e.g. `turn_start`,
 * `agent_settled`) are intentionally unmapped.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
 */
export const CANONICAL_TO_PI_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session_start",
  sessionEnd: "session_shutdown",
  preToolUse: "tool_call",
  postToolUse: "tool_result",
  preModelInvocation: "context",
  // `message_end` fires for user, assistant, and toolResult messages; the
  // generated extension filters to assistant messages so the hook runs once
  // per finalized model response. It is the closer analogue than
  // `after_provider_response`, which fires before the stream body is consumed
  // and exposes only HTTP status/headers.
  postModelInvocation: "message_end",
  beforeSubmitPrompt: "input",
  stop: "agent_end",
  preCompact: "session_before_compact",
  // Pi documents `session_compact` alongside `session_before_compact`, and
  // v0.79.10 gave both the same `reason` / `willRetry` metadata.
  postCompact: "session_compact",
};

/** Map canonical hook events to Amp Plugin API events. */
export const CANONICAL_TO_AMP_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session.start",
  preToolUse: "tool.call",
  postToolUse: "tool.result",
  beforeSubmitPrompt: "agent.start",
  stop: "agent.end",
};

/**
 * Map canonical hook events to Cline's hook script file names — the union of
 * the VS Code extension's `VALID_HOOK_TYPES` and the SDK/CLI's
 * `HookConfigFileName`, see {@link CLINE_HOOK_EVENTS}.
 */
export const CANONICAL_TO_CLINE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "TaskStart",
  sessionEnd: "SessionShutdown",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  preCompact: "PreCompact",
  notification: "Notification",
  taskCompleted: "TaskComplete",
  afterError: "TaskError",
};

/**
 * Map canonical camelCase event names to Copilot camelCase.
 */
export const CANONICAL_TO_COPILOT_EVENT_NAMES: Record<string, string> = {
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  beforeSubmitPrompt: "userPromptSubmitted",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  postToolUseFailure: "postToolUseFailure",
  stop: "agentStop",
  subagentStart: "subagentStart",
  subagentStop: "subagentStop",
  afterError: "errorOccurred",
  // On the cloud agent this fires only with trigger "auto" — there is no user
  // to request a manual compaction.
  preCompact: "preCompact",
  userPromptExpansion: "userPromptTransformed",
};

/**
 * Map Copilot camelCase event names to canonical camelCase.
 */
export const COPILOT_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_COPILOT_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to the GitHub Copilot CLI's wider event
 * surface. https://docs.github.com/en/copilot/reference/hooks-configuration
 */
export const CANONICAL_TO_COPILOTCLI_EVENT_NAMES: Record<string, string> = {
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  beforeSubmitPrompt: "userPromptSubmitted",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  postToolUseFailure: "postToolUseFailure",
  stop: "agentStop",
  subagentStart: "subagentStart",
  subagentStop: "subagentStop",
  afterError: "errorOccurred",
  preCompact: "preCompact",
  permissionRequest: "permissionRequest",
  notification: "notification",
  // Mutation-only event that fires on the transformed prompt; the canonical
  // prompt-expansion event is the closest match (Qwen's `UserPromptExpansion`
  // maps to it too).
  userPromptExpansion: "userPromptTransformed",
  // Added in Copilot CLI v1.0.51 (2026-05-20). The canonical MCP pre-call event
  // maps to the CLI's `preMcpToolCall` hook.
  beforeMCPExecution: "preMcpToolCall",
};

/** Map GitHub Copilot CLI event names back to canonical camelCase. */
export const COPILOTCLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_COPILOTCLI_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Codex CLI PascalCase.
 */
export const CANONICAL_TO_CODEXCLI_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  permissionRequest: "PermissionRequest",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
};

/**
 * Map Codex CLI PascalCase event names to canonical camelCase.
 */
export const CODEXCLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CODEXCLI_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Goose PascalCase.
 */
export const CANONICAL_TO_GOOSE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  stop: "Stop",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  beforeReadFile: "BeforeReadFile",
  afterFileEdit: "AfterFileEdit",
  beforeShellExecution: "BeforeShellExecution",
  afterShellExecution: "AfterShellExecution",
};

/**
 * Map Goose PascalCase event names to canonical camelCase.
 */
export const GOOSE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_GOOSE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to the deepagents-cli Hooks v2
 * `HookEvent` values.
 *
 * Hooks v2 went GA in deepagents-code 0.1.52 (2026-08-04) and replaced the
 * legacy dot-notation names (`session.start`, `tool.use`, …) with these twelve
 * PascalCase members. The legacy list format is still read, but is scheduled for
 * removal on 2026-09-01 (`_LEGACY_HOOKS_REMOVAL_DATE` in `hooks/loading.py`).
 *
 * Canonical `contextOffload` has no v2 counterpart. Its legacy event
 * (`context.offload`) is gone, and folding it onto `PreCompact` would silently
 * merge two distinct canonical events into one — so it is dropped for
 * deepagents instead, and reported by the hooks processor as an unsupported
 * event like any other.
 *
 * @see https://github.com/langchain-ai/deepagents `libs/code/deepagents_code/hooks/models/domain.py`
 */
export const CANONICAL_TO_DEEPAGENTS_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  sessionEnd: "SessionEnd",
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  preCompact: "PreCompact",
  stop: "Stop",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

/**
 * Map deepagents-cli `HookEvent` values to canonical camelCase.
 */
export const DEEPAGENTS_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * The legacy dot-notation event names deepagents-cli used before Hooks v2.
 * Kept for the read-only import path so a `hooks.json` still in the old format
 * round-trips into canonical events instead of being silently discarded.
 */
export const DEEPAGENTS_LEGACY_TO_CANONICAL_EVENT_NAMES: Record<string, string> = {
  "session.start": "sessionStart",
  "session.end": "sessionEnd",
  "user.prompt": "beforeSubmitPrompt",
  "permission.request": "permissionRequest",
  "tool.use": "preToolUse",
  "tool.result": "postToolUse",
  "tool.error": "postToolUseFailure",
  "task.complete": "stop",
  "context.compact": "preCompact",
  "context.offload": "contextOffload",
  "input.required": "notification",
};

/**
 * Map canonical camelCase event names to Kiro CLI camelCase.
 * Kiro CLI uses its own event naming: agentSpawn, userPromptSubmit, preToolUse,
 * postToolUse, stop. Both `sessionEnd` and `stop` canonical events map to
 * kiro's `stop`.
 */
export const CANONICAL_TO_KIRO_EVENT_NAMES: Record<string, string> = {
  sessionStart: "agentSpawn",
  sessionEnd: "stop",
  beforeSubmitPrompt: "userPromptSubmit",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  stop: "stop",
};

/**
 * Native event keys of the embedded agent-config hook format, as listed by the
 * Kiro CLI 3.0 migration guide's old-format column: `agentSpawn`,
 * `userPromptSubmit`, `preToolUse`, `postToolUse`, `fileEdited`, `fileCreated`
 * and `agentStop`/`stop`. Two of them (`fileEdited`, `fileCreated`) have no
 * canonical equivalent, so they exist only here.
 *
 * The `kiro` override block is shared with the standalone-format targets, whose
 * trigger vocabulary is different, so the alias writer uses this list to decide
 * what it can express.
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 */
export const KIRO_AGENT_CONFIG_NATIVE_EVENT_NAMES: readonly string[] = [
  "agentSpawn",
  "userPromptSubmit",
  "preToolUse",
  "postToolUse",
  "fileEdited",
  "fileCreated",
  "agentStop",
  "stop",
];

/**
 * Old agent-config event keys mapped to their standalone v1 trigger, so a
 * `kiro.hooks` block authored in the deprecated spelling still emits a valid
 * trigger for the `kiro-cli` / `kiro-ide` targets that read the same block.
 * The migration guide states the old names "map directly to their newer
 * equivalents" and spells out `agentSpawn` → `SessionStart` and `fileEdited` →
 * `PostFileSave`; the rest are the same event under the v1 casing.
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 */
export const KIRO_LEGACY_TO_KIRO_IDE_TRIGGER_NAMES: Record<string, string> = {
  agentSpawn: "SessionStart",
  userPromptSubmit: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  fileEdited: "PostFileSave",
  fileCreated: "PostFileCreate",
  agentStop: "Stop",
  stop: "Stop",
};

/**
 * Map Kiro CLI camelCase event names to canonical camelCase.
 */
export const KIRO_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_KIRO_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Kiro IDE PascalCase triggers.
 *
 * Only the canonical lifecycle events with a clean IDE equivalent are mapped.
 * Unknown keys (e.g. IDE-only `PostFileSave`/`PreTaskExec` set via the shared
 * `kiro` override block) pass through unchanged.
 * @see https://kiro.dev/docs/hooks/types/
 */
export const CANONICAL_TO_KIRO_IDE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  stop: "Stop",
};

/**
 * Map Kiro IDE PascalCase trigger names to canonical camelCase.
 */
export const KIRO_IDE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_KIRO_IDE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Junie PascalCase.
 * Junie reuses the same PascalCase names as Claude for the events it supports.
 */
export const CANONICAL_TO_JUNIE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  stop: "Stop",
  stopFailure: "StopFailure",
  permissionRequest: "PermissionRequest",
  sessionEnd: "SessionEnd",
};

/**
 * Map Junie PascalCase event names to canonical camelCase.
 */
export const JUNIE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_JUNIE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Mistral Vibe snake_case.
 *
 * Vibe documents three hook events. The canonical `stop` event maps to Vibe's
 * `post_agent` (fires after every assistant turn ending without pending tool
 * calls) — the closest documented "turn end"/"stop" equivalent.
 *
 * These are the v2.21.0 names; the pre-2.21.0 spellings (`before_tool`,
 * `after_tool`, `post_agent_turn`) are rejected by Vibe's strict `HookType`
 * enum.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
export const CANONICAL_TO_VIBE_EVENT_NAMES: Record<string, string> = {
  preToolUse: "pre_tool",
  postToolUse: "post_tool",
  stop: "post_agent",
};

/**
 * Map Mistral Vibe snake_case event names to canonical camelCase.
 */
export const VIBE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_VIBE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Qwen Code PascalCase.
 *
 * Qwen Code reuses the same Claude-style PascalCase event names for the events
 * it shares, but its supported set differs from both Claude and Gemini CLI.
 * @see https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
 */
export const CANONICAL_TO_QWENCODE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  postToolBatch: "PostToolBatch",
  beforeSubmitPrompt: "UserPromptSubmit",
  userPromptExpansion: "UserPromptExpansion",
  stop: "Stop",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  stopFailure: "StopFailure",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
  permissionRequest: "PermissionRequest",
  permissionDenied: "PermissionDenied",
  notification: "Notification",
  instructionsLoaded: "InstructionsLoaded",
  todoCreated: "TodoCreated",
  todoCompleted: "TodoCompleted",
  messageDisplay: "MessageDisplay",
  sessionDelete: "SessionDelete",
};

/**
 * Map Qwen Code PascalCase event names to canonical camelCase.
 */
export const QWENCODE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_QWENCODE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Reasonix PascalCase.
 * Reasonix explicitly mirrors Claude Code's hooks model, so it reuses the same
 * PascalCase names for the events rulesync maps.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
export const CANONICAL_TO_REASONIX_EVENT_NAMES: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  subagentStop: "SubagentStop",
  postModelInvocation: "PostLLMCall",
  notification: "Notification",
  preCompact: "PreCompact",
};

/**
 * Map Reasonix PascalCase event names to canonical camelCase.
 */
export const REASONIX_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_REASONIX_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Grok CLI PascalCase.
 * Grok Build reuses the same Claude-style PascalCase event names, so each
 * canonical arm maps to its PascalCase equivalent.
 * @see https://docs.x.ai/build/features/hooks
 */
export const CANONICAL_TO_GROKCLI_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  permissionDenied: "PermissionDenied",
  stop: "Stop",
  stopFailure: "StopFailure",
  notification: "Notification",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
};

/**
 * Map Grok CLI PascalCase event names to canonical camelCase.
 */
export const GROKCLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_GROKCLI_EVENT_NAMES).map(([k, v]) => [v, k]),
);
