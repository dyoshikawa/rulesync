---
description: Command: work-on-tons-of-errors
---

work_guidelines = $ARGUMENTS

work_guidelines: Optional

Execute the following commands in order. If an error occurs, stop executing subsequent commands and focus on resolving the encountered error.

```bash
pnpm fix | tail -n 100
pnpm typecheck | tail -n 100
pnpm test | tail -n 100
```

Modify the source code to reduce errors that appear from the relevant commands. You may repeatedly execute the relevant commands for confirmation.

The `tail` command is a preventive measure because you might get confused if you see a large number of errors at once. Therefore, removing `tail -n 100` is prohibited.

If work_guidelines are provided, follow those guidelines when making fixes.

We will eventually resolve all errors, but we'll proceed gradually. When errors are reduced by 3 files, run `git commit --no-verify` and `push`, then finish. After that, the user will give further instructions.
