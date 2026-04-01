import re

with open('src/types/hooks.ts', 'r') as f:
    content = f.read()

opencode_events = """/** Hook events supported by OpenCode. */
export const OPENCODE_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "stop",
  "afterFileEdit",
  "afterShellExecution",
  "permissionRequest",
];"""

kilo_events = """/** Hook events supported by Kilo. */
export const KILO_HOOK_EVENTS: readonly HookEvent[] = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "stop",
  "afterFileEdit",
  "afterShellExecution",
  "permissionRequest",
];"""

if kilo_events not in content:
    content = content.replace(opencode_events, kilo_events + "\n\n" + opencode_events)

with open('src/types/hooks.ts', 'w') as f:
    f.write(content)
with open('src/types/hooks.ts', 'r') as f:
    content = f.read()

opencode_names = """/**
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
};"""

kilo_names = """/**
 * Map canonical camelCase event names to Kilo dot-notation.
 */
export const CANONICAL_TO_KILO_EVENT_NAMES: Record<string, string> = {
  sessionStart: "session.created",
  preToolUse: "tool.execute.before",
  postToolUse: "tool.execute.after",
  stop: "session.idle",
  afterFileEdit: "file.edited",
  afterShellExecution: "command.executed",
  permissionRequest: "permission.asked",
};"""

if kilo_names not in content:
    content = content.replace(opencode_names, kilo_names + "\n\n" + opencode_names)

with open('src/types/hooks.ts', 'w') as f:
    f.write(content)
