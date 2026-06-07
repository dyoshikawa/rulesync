---
task_id: "T03"
title: "Run full test suite and verify no regressions"
status: "planned"
depends_on: ["T01", "T02"]
implements: ["AC#6"]
---

## Summary
Run the full test suite after T01 and T02 to verify that all existing tests pass with the updated assertions and that the new hook round-trip tests work. Confirms no regressions in existing hook event mappings or skill generation.

## Prompt
Run the project's test suite. Check the project for the test runner configuration — look at `package.json` scripts, CI config, or the project README.

Verify specifically:
1. All tests in `src/features/skills/codexcli-skill.test.ts` pass with the updated `.agents/skills` paths
2. All tests in `src/features/hooks/codexcli-hooks.test.ts` pass, including the updated filtering assertion and new round-trip tests
3. The existing 6 hook event mappings (`sessionStart`, `preToolUse`, `postToolUse`, `beforeSubmitPrompt`, `stop`, `permissionRequest`) still work correctly — no regressions
4. No other test files fail as a result of the changes

If any tests fail, investigate and fix the root cause. Do not skip or mark tests as expected failures.

## Focus
- The behavioral invariants from the design doc: all existing hook events must continue mapping correctly, root rule generation is unaffected, skill frontmatter schema and validation are unaffected.
- If the test runner uses parallelization, watch for test isolation issues.
- Check that the linter passes as well (the project uses oxlint).

## Verify
- [ ] AC#6: All existing tests pass with updated assertions; new tests cover the 3 hook events; oxlint reports no errors
