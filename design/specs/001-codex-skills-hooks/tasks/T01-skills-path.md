---
task_id: "T01"
title: "Update Codex CLI skills output path to .agents/skills"
status: "planned"
depends_on: []
implements: ["FR#1", "FR#2", "FR#6", "AC#1", "AC#5"]
---

## Summary
Change the Codex CLI skill adapter to emit skills to `.agents/skills/` instead of `.codex/skills/` for both project and global modes. Update the gitignore entry to match. Update all test assertions.

## Prompt
In `src/features/skills/codexcli-skill.ts`, change `.codex/skills` to `.agents/skills` in two locations:

1. The constructor default parameter `relativeDirPath` (line 49): change `join(".codex", "skills")` to `join(".agents", "skills")`
2. `getSettablePaths()` return value (line 86): change `join(".codex", "skills")` to `join(".agents", "skills")`

In `src/cli/commands/gitignore-entries.ts`, change the codexcli skills entry (line 113) from `"**/.codex/skills/"` to `"**/.agents/skills/"`.

In `src/features/skills/codexcli-skill.test.ts`, update all ~13 occurrences of `.codex/skills` (both assertions and fixture construction) to `.agents/skills`. Use find-and-replace — every `join(".codex", "skills")` becomes `join(".agents", "skills")`, and every `".codex/skills"` string becomes `".agents/skills"`.

Follow the pattern in `src/features/skills/agentsmd-skill.ts` which already uses `join(".agents", "skills")`.

## Focus
- The constructor default and `getSettablePaths()` must use identical paths — they're used in different code paths but must agree.
- The class comment (line 44-45) references `.codex/skills` and `~/.codex/skills` — update the comment to reflect `.agents/skills`.
- `getSettablePaths()` currently ignores the `global` flag (same path for both). This behavior should be preserved — both project and global use `.agents/skills`.
- The gitignore entry uses `**/` glob prefix per the existing convention.

## Verify
- [ ] FR#1: `CodexCliSkill.getSettablePaths({ global: false }).relativeDirPath` equals `join(".agents", "skills")`
- [ ] FR#2: `CodexCliSkill.getSettablePaths({ global: true }).relativeDirPath` equals `join(".agents", "skills")`
- [ ] FR#6: The codexcli skills entry in `gitignore-entries.ts` reads `"**/.agents/skills/"`
- [ ] AC#1: Both `global: true` and `global: false` return the same `.agents/skills` path (same method, two flag values)
- [ ] AC#5: Gitignore entry for codexcli skills reads `"**/.agents/skills/"`
