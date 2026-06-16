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
  timeout: z.optional(z.number()),
  matcher: z.optional(safeString),
  prompt: z.optional(safeString),
  loop_limit: z.optional(z.nullable(z.number())),
  name: z.optional(safeString),
  description: z.optional(safeString),
  // Cursor: when true, a hook failure (crash, timeout, invalid JSON) blocks the
  // action instead of allowing it through. https://cursor.com/docs/hooks
  failClosed: z.optional(z.boolean()),
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
  | "messageDisplay";

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

/** Hook events supported by Claude Code. */
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
 * `notification`.
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

/** Hook events supported by Gemini CLI. */
export const GEMINICLI_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "stop",
  "beforeAgentResponse",
  "afterAgentResponse",
  "beforeToolSelection",
  "preToolUse",
  "postToolUse",
  "preCompact",
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
 * "turn end"/"stop" event, matching how codexcli/copilot/geminicli map their
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
 * Junie CLI exposes four lifecycle events under the `"hooks"` key of
 * `~/.junie/config.json`: `SessionStart`, `UserPromptSubmit`, `Stop`, and
 * `SessionEnd`. Matchers apply only to `SessionStart` / `SessionEnd`
 * (e.g. `startup` / `resume`); `UserPromptSubmit` and `Stop` are
 * matcher-less. Only `type: "command"` hooks are supported. Project-local
 * hooks are ignored for safety.
 * @see https://junie.jetbrains.com/docs/junie-cli-hooks.html
 */
export const JUNIE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "beforeSubmitPrompt",
  "stop",
  "sessionEnd",
];

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
  geminicli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  codexcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  goose: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  deepagents: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  kiro: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "kiro-cli": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  devin: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  augmentcode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "antigravity-ide": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  "antigravity-cli": z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  junie: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  vibe: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
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
};

/**
 * Map Claude PascalCase event names to canonical camelCase.
 */
export const CLAUDE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_EVENT_NAMES).map(([k, v]) => [v, k]),
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
};

/** Map GitHub Copilot CLI event names back to canonical camelCase. */
export const COPILOTCLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_COPILOTCLI_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical camelCase event names to Gemini CLI PascalCase.
 */
export const CANONICAL_TO_GEMINICLI_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeSubmitPrompt: "BeforeAgent",
  stop: "AfterAgent",
  beforeAgentResponse: "BeforeModel",
  afterAgentResponse: "AfterModel",
  beforeToolSelection: "BeforeToolSelection",
  preToolUse: "BeforeTool",
  postToolUse: "AfterTool",
  preCompact: "PreCompress",
  notification: "Notification",
};

/**
 * Map Gemini CLI PascalCase event names to canonical camelCase.
 */
export const GEMINICLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_GEMINICLI_EVENT_NAMES).map(([k, v]) => [v, k]),
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
 * Map canonical camelCase event names to Junie PascalCase.
 * Junie reuses the same PascalCase names as Claude for the events it supports.
 */
export const CANONICAL_TO_JUNIE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
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
