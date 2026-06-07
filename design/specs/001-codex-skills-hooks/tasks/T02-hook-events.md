---
task_id: "T02"
title: "Wire 3 missing Codex CLI hook events"
status: "planned"
depends_on: []
implements: ["FR#3", "FR#4", "FR#5", "AC#2", "AC#3", "AC#4"]
---

## Summary
Add the three unmapped hook events (`subagentStart`, `subagentStop`, `preCompact`) to the Codex CLI hook event array and name mapping. These events already exist in rulesync's canonical model but have no Codex mapping, so hooks using them are silently dropped.

## Prompt
In `src/types/hooks.ts`, make two changes:

1. Add three entries to the `CODEXCLI_HOOK_EVENTS` array (starts at line 192):
   - `"subagentStart"`
   - `"subagentStop"`
   - `"preCompact"`

2. Add three entries to `CANONICAL_TO_CODEXCLI_EVENT_NAMES` (starts at line 423):
   - `subagentStart: "SubagentStart"`
   - `subagentStop: "SubagentStop"`
   - `preCompact: "PreCompact"`

The reverse map `CODEXCLI_TO_CANONICAL_EVENT_NAMES` auto-generates via `Object.fromEntries()` from the forward map, so no additional change is needed there.

In `src/features/hooks/codexcli-hooks.test.ts`, update the existing test at line 86 that asserts `SubagentStop` is undefined (it was being filtered out because it wasn't in `CODEXCLI_HOOK_EVENTS`). Add new test cases for round-trip conversion of all three events:
- `subagentStart` → `SubagentStart` → `subagentStart`
- `subagentStop` → `SubagentStop` → `subagentStop`
- `preCompact` → `PreCompact` → `preCompact`

Follow the PascalCase naming convention used by the Claude adapter mapping in the same file (see context.md Convention Examples).

## Focus
- The `CODEXCLI_HOOK_EVENTS` array controls which events are considered "supported" by the Codex adapter. Events not in this array are filtered out during conversion — that's why the existing test asserts `SubagentStop` is undefined.
- `codexcli-hooks.ts` imports these constants and uses them in `CODEXCLI_CONVERTER_CONFIG`. No changes to that file are needed — it picks up the new entries automatically.
- `hooks-processor.ts` also imports `CODEXCLI_HOOK_EVENTS` — no changes needed there either.
- The `codexcli-hooks.test.ts` test at line 86 (`expect(parsed.hooks.SubagentStop).toBeUndefined()`) directly contradicts the new behavior — it must be updated to expect the event to be present.

## Verify
- [ ] FR#3: A rulesync hook with event `subagentStart` converts to Codex event name `SubagentStart`
- [ ] FR#4: A rulesync hook with event `subagentStop` converts to Codex event name `SubagentStop`
- [ ] FR#5: A rulesync hook with event `preCompact` converts to Codex event name `PreCompact`
- [ ] AC#2: `CODEXCLI_HOOK_EVENTS` includes all three new events
- [ ] AC#3: `CANONICAL_TO_CODEXCLI_EVENT_NAMES` maps all three events to PascalCase
- [ ] AC#4: Round-trip tests pass for all three events
