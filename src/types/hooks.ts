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
const safeString = z.pipe(
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
  type: z.optional(z.enum(["command", "prompt"])),
  timeout: z.optional(z.number()),
  matcher: z.optional(safeString),
  prompt: z.optional(safeString),
  loop_limit: z.optional(z.nullable(z.number())),
  name: z.optional(safeString),
  description: z.optional(safeString),
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

/** All canonical hook types. */
export type HookType = "command" | "prompt";

/**
 * All canonical hook event names.
 * Each tool supports a subset of these events.
 */
export type HookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "preToolUse"
  | "postToolUse"
  | "beforeSubmitPrompt"
  | "stop"
  | "subagentStop"
  | "preCompact"
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
  | "worktreeRemove";

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

/** Hook events supported by Copilot. */
export const COPILOT_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "afterError",
];

/** Hook events supported by Factory Droid. */
export const FACTORYDROID_HOOK_EVENTS: readonly HookEvent[] = [
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
];

/** Hook events supported by deepagents-cli. */
export const DEEPAGENTS_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "permissionRequest",
  "postToolUseFailure",
  "stop",
  "preCompact",
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
  opencode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  kilo: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  factorydroid: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  geminicli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  codexcli: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  deepagents: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
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
};

/**
 * Map Claude PascalCase event names to canonical camelCase.
 */
export const CLAUDE_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_EVENT_NAMES).map(([k, v]) => [v, k]),
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
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  setup: "Setup",
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
  afterError: "errorOccurred",
};

/**
 * Map Copilot camelCase event names to canonical camelCase.
 */
export const COPILOT_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_COPILOT_EVENT_NAMES).map(([k, v]) => [v, k]),
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
};

/**
 * Map Codex CLI PascalCase event names to canonical camelCase.
 */
export const CODEXCLI_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CODEXCLI_EVENT_NAMES).map(([k, v]) => [v, k]),
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
};

/**
 * Map deepagents-cli dot-notation event names to canonical camelCase.
 */
export const DEEPAGENTS_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES).map(([k, v]) => [v, k]),
);
