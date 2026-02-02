import { z } from "zod/mini";

/**
 * Canonical hook definition (Cursor-style).
 * Used in .rulesync/hooks.json and mapped to tool-specific formats.
 */
export const HookDefinitionSchema = z.object({
  command: z.optional(z.string()),
  type: z.optional(z.enum(["command", "prompt"])),
  timeout: z.optional(z.number()),
  matcher: z.optional(z.string()),
  prompt: z.optional(z.string()),
  loop_limit: z.optional(z.nullable(z.number())),
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

/** Shared hook events supported by both Cursor and Claude. */
export const COMMON_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
] as const;

/** Cursor-only hook events (not supported by Claude). */
export const CURSOR_ONLY_HOOK_EVENTS = [
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
] as const;

/** Claude-only hook events (not supported by Cursor). */
export const CLAUDE_ONLY_HOOK_EVENTS = ["permissionRequest", "notification", "setup"] as const;

/** All hook events supported by Cursor (common + cursor-only). */
export const CURSOR_HOOK_EVENTS: readonly string[] = [
  ...COMMON_HOOK_EVENTS,
  ...CURSOR_ONLY_HOOK_EVENTS,
];

/** All hook events supported by Claude (common + claude-only). */
export const CLAUDE_HOOK_EVENTS: readonly string[] = [
  ...COMMON_HOOK_EVENTS,
  ...CLAUDE_ONLY_HOOK_EVENTS,
];

const hooksRecordSchema = z.record(z.string(), z.array(HookDefinitionSchema));

/**
 * Canonical hooks config (Cursor-style event names in camelCase).
 */
export const HooksConfigSchema = z.object({
  version: z.optional(z.number()),
  hooks: hooksRecordSchema,
  cursor: z.optional(z.object({ hooks: z.optional(hooksRecordSchema) })),
  claudecode: z.optional(z.object({ hooks: z.optional(hooksRecordSchema) })),
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
