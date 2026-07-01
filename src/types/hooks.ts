import { z } from "zod/mini";

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
 * Canonical hook definition.
 * Used in .rulesync/hooks.json and mapped to tool-specific formats.
 */
export const HookDefinitionSchema = z.looseObject({
  command: z.optional(safeString),
  type: z.optional(z.enum(["command", "prompt", "http"])),
  // Qwen Code: target URL for `http` hooks (the hook POSTs JSON to this URL).
  // https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
  url: z.optional(safeString),
  timeout: z.optional(z.number()),
  matcher: z.optional(safeString),
  prompt: z.optional(safeString),
  loop_limit: z.optional(z.nullable(z.number())),
  name: z.optional(safeString),
  description: z.optional(safeString),
  // Cursor: when true, a hook failure (crash, timeout, invalid JSON) blocks the
  // action instead of allowing it through. https://cursor.com/docs/hooks
  failClosed: z.optional(z.boolean()),
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
  shell: z.optional(safeString),
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
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

/** All canonical hook types. */
export type HookType = "command" | "prompt" | "http";

/**
 * All canonical hook event names.
 * Each tool supports a subset of these events.
 */
export type HookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "preToolUse"
  | "postToolUse"
  | "preModelInvocation"
  | "postModelInvocation"
  | "beforeSubmitPrompt"
  | "stop"
  | "subagentStop"
  | "preCompact"
  | "postCompact"
  | "contextOffload"
  | "postToolUseFailure"
  | "subagentStart"
  | "beforeShellExecution"
  | "afterShellExecution"
  | "beforeMCPExecution"
  | "afterMCPExecution"
  | "beforeReadFile"
  | "afterFileEdit"
  | "beforeAgentResponse"
  | "afterAgentResponse"
  | "afterAgentThought"
  | "beforeTabFileRead"
  | "afterTabFileEdit"
  | "permissionRequest"
  | "notification"
  | "setup"
  | "afterError"
  | "beforeToolSelection"
  | "worktreeCreate"
  | "worktreeRemove"
  | "workspaceOpen"
  | "messageDisplay"
  | "todoCreated"
  | "todoCompleted"
  | "stopFailure"
  | "instructionsLoaded"
  | "userPromptExpansion"
  | "postToolBatch"
  | "permissionDenied"
  | "taskCreated"
  | "taskCompleted"
  | "teammateIdle"
  | "configChange"
  | "cwdChanged"
  | "fileChanged"
  | "elicitation"
  | "elicitationResult";

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
  "postCompact",
  "elicitation",
  "elicitationResult",
];

/**
 * Hook events supported by Devin Local (native `.devin/` hooks).
 *
 * Devin Local adopts a Claude-Code-style lifecycle hooks surface. It documents
 * seven events: `PreToolUse`, `PostToolUse`, `PermissionRequest`,
 * `UserPromptSubmit`, `Stop`, `SessionStart`, and `SessionEnd`. The
 * tool/permission events (`PreToolUse`/`PostToolUse`/`PermissionRequest`) carry
 * a `matcher` (regex against `tool_name`); the session/turn events do not.
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
];

/** Hook events supported by OpenCode. */
export const OPENCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "stop",
  "afterFileEdit",
  "afterShellExecution",
  "permissionRequest",
];

/** Hook events supported by Kilo. (Currently identical to OpenCode) */
export const KILO_HOOK_EVENTS: readonly HookEvent[] = OPENCODE_HOOK_EVENTS;

/**
 * Hook events supported by GitHub Copilot (cloud coding agent).
 *
 * GitHub now documents an eight-event surface for `.github/hooks/*.json`:
 * `sessionStart`, `sessionEnd`, `userPromptSubmitted` ← `beforeSubmitPrompt`,
 * `preToolUse`, `postToolUse`, `agentStop` ← `stop`, `subagentStop`, and
 * `errorOccurred` ← `afterError`. `subagentStart` is intentionally absent: it is
 * not part of the documented cloud-agent surface.
 *
 * @see https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks
 * @see https://docs.github.com/en/copilot/concepts/agents/hooks
 */
export const COPILOT_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "stop",
  "subagentStop",
  "afterError",
];

/**
 * Hook events supported by the GitHub Copilot CLI (`copilotcli-hooks.ts`).
 *
 * The CLI documents a wider event surface than the shared cloud-agent set, so
 * `copilotcli` diverges from {@link COPILOT_HOOK_EVENTS}. Full documented set:
 * `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`,
 * `postToolUse`, `postToolUseFailure`, `agentStop`, `subagentStart`,
 * `subagentStop`, `errorOccurred`, `preCompact`, `permissionRequest`,
 * `notification`, `preMcpToolCall` ← `beforeMCPExecution`.
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
 * The canonical `notification` event maps to dcode's `input.required`
 * (human-in-the-loop interrupt) — the closest documented equivalent.
 * https://docs.langchain.com/oss/python/deepagents/cli/configuration
 */
export const DEEPAGENTS_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "permissionRequest",
  "postToolUseFailure",
  "stop",
  "preCompact",
  "contextOffload",
  "notification",
];

/** Hook events supported by Codex CLI. */
export const CODEXCLI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
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
 * @see https://goose-docs.ai/blog/2026/05/14/goose-hooks/
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
  "subagentStart",
  "subagentStop",
];

/** Hook events supported by Kiro CLI. */
export const KIRO_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "stop",
];

/**
 * Hook events supported by the Kiro IDE (`.kiro/hooks/*.json` v1).
 *
 * Kiro IDE 1.0 exposes PascalCase triggers. rulesync maps the canonical
 * lifecycle events that have a clean 1:1 IDE equivalent: `SessionStart`,
 * `Stop`, `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`. The IDE also
 * documents file-event (`PostFileCreate`/`PostFileSave`/`PostFileDelete`) and
 * spec-task (`PreTaskExec`/`PostTaskExec`) triggers that have no canonical
 * equivalent; those can still be emitted verbatim via a `kiro-ide` override
 * block (unknown event keys pass through unchanged).
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
 * SessionStart / SessionEnd / Stop session events (no matcher).
 * @see https://docs.augmentcode.com/cli/hooks
 */
export const AUGMENTCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "preToolUse",
  "postToolUse",
  "sessionStart",
  "sessionEnd",
  "stop",
];

/**
 * Hook events supported by Mistral Vibe (mistral-vibe).
 *
 * Vibe exposes three experimental hook events in `.vibe/hooks.toml`:
 * `before_tool` ← `preToolUse`, `after_tool` ← `postToolUse`, and
 * `post_agent_turn` ← `stop` (fires after every assistant turn that ends
 * without pending tool calls — the closest canonical equivalent to a
 * "turn end"/"stop" event, matching how codexcli/copilot map their
 * stop events). Only the tool events (`before_tool`/`after_tool`) carry the
 * `match` tool-name matcher (fnmatch glob or `re:` regex) and the `strict`
 * flag; `post_agent_turn` carries neither. Only `type: "command"` hooks are
 * relevant.
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
 * @see https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
 */
export const QWENCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeSubmitPrompt",
  "stop",
  "stopFailure",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
  "permissionRequest",
  "notification",
  "todoCreated",
  "todoCompleted",
];

/**
 * Hook events supported by Reasonix.
 *
 * Reasonix's `.reasonix/settings.json` (project) / `~/.reasonix/settings.json`
 * (global) documents a ten-event surface (`PreToolUse`, `PostToolUse`,
 * `UserPromptSubmit`, `Stop`, `PostLLMCall`, `SessionStart`, `SessionEnd`,
 * `SubagentStop`, `Notification`, `PreCompact`), but only the four events the
 * upstream issue scoped in are mapped here: `PreToolUse`, `PostToolUse`,
 * `UserPromptSubmit` ← `beforeSubmitPrompt`, and `Stop`. `match` (Reasonix's
 * matcher field name) is honored only on `PreToolUse`/`PostToolUse`, matching
 * the canonical `matcher` field's tool-event scoping used by other adapters.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
export const REASONIX_HOOK_EVENTS: readonly HookEvent[] = [
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
];

/**
 * Hook events supported by Hermes Agent's native Shell Hooks system.
 *
 * Hermes validates hook events against a fixed `VALID_HOOKS` set:
 * `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`,
 * `pre_verify`, `on_session_start`, `on_session_end`, `on_session_finalize`,
 * `on_session_reset`, `subagent_start`, `subagent_stop`, `pre_gateway_dispatch`,
 * `pre_approval_request`, `post_approval_response`, `transform_tool_result`,
 * `transform_terminal_output`, `transform_llm_output`. Only the events with a
 * clean 1:1 canonical equivalent are mapped here; the remaining `VALID_HOOKS`
 * entries (`pre_verify`, `on_session_finalize`, `on_session_reset`,
 * `pre_gateway_dispatch`, `pre_approval_request`, `post_approval_response`, the
 * `transform_*` result-rewriting hooks) have no canonical rulesync equivalent,
 * so no canonical event maps to them.
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

/**
 * Canonical hooks config (canonical event names in camelCase).
 */
export const HooksConfigSchema = z.looseObject({
  version: z.optional(z.number()),
  hooks: hooksRecordSchema,
  cursor: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  claudecode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  copilot: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  copilotcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  opencode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  kilo: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
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
  afterShellExecution: "command.executed",
  permissionRequest: "permission.asked",
};

/**
 * Map canonical camelCase event names to Kilo dot-notation.
 * (Currently identical to OpenCode)
 */
export const CANONICAL_TO_KILO_EVENT_NAMES: Record<string, string> =
  CANONICAL_TO_OPENCODE_EVENT_NAMES;

/**
 * Map canonical camelCase event names to Copilot camelCase.
 */
export const CANONICAL_TO_COPILOT_EVENT_NAMES: Record<string, string> = {
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  beforeSubmitPrompt: "userPromptSubmitted",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  stop: "agentStop",
  subagentStop: "subagentStop",
  afterError: "errorOccurred",
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
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

/**
 * Map Goose PascalCase event names to canonical camelCase.
 */
export const GOOSE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_GOOSE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to deepagents-cli dot-notation.
 */
export const CANONICAL_TO_DEEPAGENTS_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session.start",
  sessionEnd: "session.end",
  beforeSubmitPrompt: "user.prompt",
  permissionRequest: "permission.request",
  postToolUseFailure: "tool.error",
  stop: "task.complete",
  preCompact: "context.compact",
  contextOffload: "context.offload",
  // dcode's human-in-the-loop interrupt; canonical `notification` is the closest fit.
  notification: "input.required",
};

/**
 * Map deepagents-cli dot-notation event names to canonical camelCase.
 */
export const DEEPAGENTS_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES).map(([k, v]) => [v, k]),
);

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
 * Map Kiro CLI camelCase event names to canonical camelCase.
 */
export const KIRO_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_KIRO_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Kiro IDE PascalCase triggers.
 *
 * Only the canonical lifecycle events with a clean IDE equivalent are mapped.
 * Unknown keys (e.g. IDE-only `PostFileSave`/`PreTaskExec` set via a `kiro-ide`
 * override) pass through unchanged.
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
 * Vibe documents three experimental hook events. The canonical `stop` event maps
 * to Vibe's `post_agent_turn` (fires after every assistant turn ending without
 * pending tool calls) — the closest documented "turn end"/"stop" equivalent.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
export const CANONICAL_TO_VIBE_EVENT_NAMES: Record<string, string> = {
  preToolUse: "before_tool",
  postToolUse: "after_tool",
  stop: "post_agent_turn",
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
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  stopFailure: "StopFailure",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  todoCreated: "TodoCreated",
  todoCompleted: "TodoCompleted",
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
 * PascalCase names for the four events rulesync maps.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
export const CANONICAL_TO_REASONIX_EVENT_NAMES: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
};

/**
 * Map Reasonix PascalCase event names to canonical camelCase.
 */
export const REASONIX_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_REASONIX_EVENT_NAMES).map(([k, v]) => [v, k]),
);
