# Context: Codex CLI Skills Path and Hook Event Mapping

## Problem & Motivation
The Codex CLI adapter in rulesync emits skills to `.codex/skills/`, but upstream (OpenAI) has canonicalized `.agents/skills/` as the preferred discovery path. The global path `~/.codex/skills/` is explicitly deprecated. Additionally, Codex CLI supports 10 hook lifecycle events but rulesync only maps 6 — three events that already exist in rulesync's canonical model have no Codex mapping, so hooks using those events are silently dropped during generation.

## Visual Artifacts
None.

## Key Decisions
1. Both project-level and global skills paths change to `.agents/skills/` for consistency, even though project-level `.codex/skills/` still works upstream.
2. Only 3 of the 4 missing hook events are wired (`subagentStart`, `subagentStop`, `preCompact`). `postCompact` is skipped because it would require adding a new canonical event to the shared model.
3. The gitignore entry for codexcli skills must also be updated to match the new path.

## Constraints & Anti-Patterns
- Do NOT add `postCompact` to the canonical HookEvent model or Codex mappings.
- Do NOT change rules paths (`.codex/memories/`) — that's a separate issue (#1765).
- Do NOT add deprecation warnings or migration tooling for existing `.codex/skills/` output.
- Use `join()` from `node:path` for all filesystem paths per project conventions.
- Use `z.looseObject()` for any zod schemas representing frontmatter keys.

## Design Doc References
- `## Architecture` — exact file paths and line numbers for each change
- `## Convention Examples` — Claude adapter hook mapping pattern, agentsmd skill path pattern, gitignore entries registry pattern
- `## Test Strategy` — which test files need adapting and what new coverage is needed
- `## Edge Cases` — orphaned `.codex/skills/` files after regeneration (acceptable)

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
