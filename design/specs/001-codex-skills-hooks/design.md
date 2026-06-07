# Design: Codex CLI Skills Path and Hook Event Mapping

**Date:** 2026-06-07
**Status:** archived
**Scope-mode:** hold

## Problem

The Codex CLI adapter emits skills to `.codex/skills/`, but upstream has canonicalized `.agents/skills/` as the preferred location. The global path `~/.codex/skills/` is explicitly deprecated. Users generating skills for Codex get output in a path that's on its way out, and global skills target a deprecated directory that may stop working.

Separately, Codex CLI now supports 10 hook lifecycle events, but rulesync only maps 6. Three events that already exist in rulesync's canonical model (`subagentStart`, `subagentStop`, `preCompact`) have no Codex mapping, so hooks using those events are silently dropped during generation.

## Goals

- Skills output lands in `.agents/skills/` for both project and global modes
- The 3 unmapped hook events (`subagentStart`, `subagentStop`, `preCompact`) are wired to their Codex equivalents (`SubagentStart`, `SubagentStop`, `PreCompact`)
- All affected tests pass
- Issue #1685 is closeable

## Non-Goals

- Adding `postCompact` to the canonical hook event model (needs a broader canonical model change)
- Fixing rules path issues (#1765 — separate bug, separate fix)
- Deprecation warnings or migration tooling for existing `.codex/skills/` output

## User Scenarios

### Developer: rulesync user targeting Codex CLI
- **Goal:** generate skills and hooks that Codex CLI discovers and loads
- **Context:** running `npx rulesync generate -t codexcli`

#### Generate skills
1. **Runs rulesync generate for codexcli**
   - Sees: skills written to `.agents/skills/<name>/SKILL.md`
   - Then: Codex CLI discovers skills via canonical `.agents/skills/` path

#### Generate hooks with subagent/compact events
1. **Defines a hook using subagentStart, subagentStop, or preCompact**
   - Sees: hook appears in `.codex/hooks.json` with correct PascalCase event name
   - Then: Codex CLI fires the hook at the correct lifecycle point

## Functional Requirements

- **FR#1** Skills generated for codexcli in project mode are written to `.agents/skills/` instead of `.codex/skills/`
- **FR#2** Skills generated for codexcli in global mode are written to `.agents/skills/` instead of `.codex/skills/`
- **FR#3** The canonical `subagentStart` event maps to Codex CLI's `SubagentStart`
- **FR#4** The canonical `subagentStop` event maps to Codex CLI's `SubagentStop`
- **FR#5** The canonical `preCompact` event maps to Codex CLI's `PreCompact`
- **FR#6** The gitignore entry for codexcli skills reflects the new `.agents/skills/` path

## Edge Cases

- Existing projects with skills already in `.codex/skills/` will have orphaned files after regenerating. This is acceptable — rulesync doesn't manage cleanup of old output paths, and `.codex/skills/` still works for project-level discovery.

## Acceptance Criteria

- **AC#1** `CodexCliSkill.getSettablePaths()` returns `.agents/skills` for both `global: true` and `global: false` (FR#1, FR#2)
- **AC#2** `CODEXCLI_HOOK_EVENTS` includes `subagentStart`, `subagentStop`, and `preCompact` (FR#3, FR#4, FR#5)
- **AC#3** `CANONICAL_TO_CODEXCLI_EVENT_NAMES` maps the 3 new events to their PascalCase equivalents (FR#3, FR#4, FR#5)
- **AC#4** Round-trip conversion (canonical → codexcli → canonical) preserves the 3 new events
- **AC#5** Gitignore entries for codexcli skills use `**/.agents/skills/` (FR#6)
- **AC#6** All existing tests pass with updated assertions; new tests cover the 3 hook events

## Key Constraints

No feature-specific constraints identified during discovery.

## Dependencies and Assumptions

- Assumes Codex CLI's PascalCase naming convention (`SubagentStart`, `SubagentStop`, `PreCompact`) matches the upstream documentation verified in issue #1685
- Assumes the reverse mapping (`CODEXCLI_TO_CANONICAL_EVENT_NAMES`) auto-generates from the forward map via `Object.fromEntries()`, so only the forward map needs updating

## Architecture

### Skills path change

Two locations in `src/features/skills/codexcli-skill.ts`:

1. `getSettablePaths()` (line 78-88): change `join(".codex", "skills")` to `join(".agents", "skills")`
2. Constructor default for `relativeDirPath` (line 49): change `join(".codex", "skills")` to `join(".agents", "skills")`

Pattern matches `agentsmd-skill.ts` which already uses `join(".agents", "skills")`.

### Hook event wiring

Two locations in `src/types/hooks.ts`:

1. `CODEXCLI_HOOK_EVENTS` array (line 192-199): add `"subagentStart"`, `"subagentStop"`, `"preCompact"` to the array
2. `CANONICAL_TO_CODEXCLI_EVENT_NAMES` map (line 423-430): add 3 entries following the existing PascalCase pattern:
   - `subagentStart: "SubagentStart"`
   - `subagentStop: "SubagentStop"`
   - `preCompact: "PreCompact"`

The reverse map `CODEXCLI_TO_CANONICAL_EVENT_NAMES` auto-generates via `Object.fromEntries()`, so no additional change needed.

Pattern matches the Claude adapter's mapping in the same file.

### Gitignore entry

In `src/cli/commands/gitignore-entries.ts` (line 113): change `"**/.codex/skills/"` to `"**/.agents/skills/"` for the codexcli skills entry.

## Replacement Targets

No existing code is being replaced. The `.codex/skills/` path is being updated, not removed — the old path string literals are changed in place.

## Convention Examples

### Hook event mapping pattern

**Source:** `src/types/hooks.ts:256-270`

```typescript
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
```

### Skill path pattern

**Source:** `src/features/skills/agentsmd-skill.ts`

```typescript
static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
  if (options?.global) {
    throw new Error("AgentsmdSkill does not support global mode.");
  }
  return {
    relativeDirPath: join(".agents", "skills"),
  };
}
```

### Gitignore entries registry

**Source:** `src/cli/commands/gitignore-entries.ts:112-117`

```typescript
{ target: "codexcli", feature: "ignore", entry: "**/.codexignore" },
{ target: "codexcli", feature: "skills", entry: "**/.codex/skills/" },
{ target: "codexcli", feature: "subagents", entry: "**/.codex/agents/" },
{ target: "codexcli", feature: "general", entry: "**/.codex/memories/" },
{ target: "codexcli", feature: "general", entry: "**/.codex/config.toml" },
{ target: "codexcli", feature: "hooks", entry: "**/.codex/hooks.json" },
```

## Alternatives Considered

**Keep `.codex/skills/` for project-level, only change global:** Since `.codex/skills/` still works for project-level discovery, we could change only global. Rejected because upstream has canonicalized `.agents/skills/` as the preferred path, and consistency between project and global is simpler to maintain.

## Test Strategy

### Existing Tests to Adapt

- `src/features/skills/codexcli-skill.test.ts` — ~13 occurrences of `.codex/skills` (assertions and fixture construction); update all to `.agents/skills`
- `src/features/hooks/codexcli-hooks.test.ts` — line 86 asserts `SubagentStop` is undefined (filtered out); this assertion should be removed or inverted since the event will now be mapped

### New Test Coverage

- Hook round-trip for `subagentStart` → `SubagentStart` → `subagentStart` (FR#3)
- Hook round-trip for `subagentStop` → `SubagentStop` → `subagentStop` (FR#4)
- Hook round-trip for `preCompact` → `PreCompact` → `preCompact` (FR#5)

### Tests to Remove

No tests to remove.

## Documentation Updates

No documentation updates required — the README documents rulesync's general usage, not tool-specific output paths. The issue (#1685) will be closed by the PR.

## Impact

### Changed Files

- `src/types/hooks.ts` — add 3 events to `CODEXCLI_HOOK_EVENTS` and 3 mappings to `CANONICAL_TO_CODEXCLI_EVENT_NAMES` (shared type file, cross-cutting)
- `src/features/skills/codexcli-skill.ts` — change path from `.codex/skills` to `.agents/skills` in 2 locations
- `src/cli/commands/gitignore-entries.ts` — update 1 entry
- `src/features/skills/codexcli-skill.test.ts` — update 9 path assertions
- `src/features/hooks/codexcli-hooks.test.ts` — update filtering assertions, add round-trip tests for 3 new events

### Behavioral Invariants

- All existing hook events (`sessionStart`, `preToolUse`, `postToolUse`, `beforeSubmitPrompt`, `stop`, `permissionRequest`) must continue mapping correctly
- Root rule generation (`AGENTS.md`) is unaffected
- Non-root rule generation (`.codex/memories/`) is unaffected (separate issue)
- Skill frontmatter schema and validation are unaffected

### Blast Radius

- The `.gitignore` generated by rulesync will change for codexcli skills (from `.codex/skills/` to `.agents/skills/`). Projects regenerating gitignore entries will see the new pattern.
- Existing `.codex/skills/` directories in user projects become orphaned after regeneration. No automatic cleanup.

## Open Questions

None.
