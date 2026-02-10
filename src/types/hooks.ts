import { z } from "zod/mini";

/**
 * Control characters that must not appear in strings embedded in generated code.
 * Used for command and matcher fields.
 */
export const CONTROL_CHARS = ["\\n", "\\r", "\\0"] as const;

/**
 * A string that must not contain newline (\\n), carriage return (\\r), or NUL (\\0) characters.
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
 * Canonical hook definition (Cursor-style).
 * Used in .rulesync/hooks.json and mapped to tool-specific formats.
 */
export const HookDefinitionSchema = z.looseObject({
  command: z.optional(safeString),
  type: z.optional(z.enum(["command", "prompt"])),
  timeout: z.optional(z.number()),
  matcher: z.optional(safeString),
  prompt: z.optional(z.string()),
  loop_limit: z.optional(z.nullable(z.number())),
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
  | "afterAgentResponse"
  | "afterAgentThought"
  | "beforeTabFileRead"
  | "afterTabFileEdit"
  | "permissionRequest"
  | "notification"
  | "setup";

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

const hooksRecordSchema = z.record(z.string(), z.array(HookDefinitionSchema));

/**
 * Canonical hooks config (Cursor-style event names in camelCase).
 */
export const HooksConfigSchema = z.looseObject({
  version: z.optional(z.number()),
  hooks: hooksRecordSchema,
  cursor: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  claudecode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  opencode: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
  factorydroid: z.optional(z.looseObject({ hooks: z.optional(hooksRecordSchema) })),
});

export type HooksConfig = z.infer<typeof HooksConfigSchema>;

/**
 * Map canonical (Cursor) camelCase event names to Claude PascalCase.
 * Includes common and Claude-only events.
 */
export const CURSOR_TO_CLAUDE_EVENT_NAMES: Record<string, string> = {
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
 * Map Claude PascalCase event names to canonical camelCase.
 */
export const CLAUDE_TO_CURSOR_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CURSOR_TO_CLAUDE_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Map canonical (Cursor) camelCase event names to OpenCode dot-notation.
 * Only includes events that have a meaningful OpenCode plugin equivalent.
 */
export const CURSOR_TO_OPENCODE_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session.created",
  preToolUse: "tool.execute.before",
  postToolUse: "tool.execute.after",
  stop: "session.idle",
  afterFileEdit: "file.edited",
  afterShellExecution: "command.executed",
  permissionRequest: "permission.asked",
};
