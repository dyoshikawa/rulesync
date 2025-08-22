---
name: fix-planner
description: This is the code fix planner. The user asks the agent to plan to fix and stabilize the code.
model: opus
---

Execute the all following commands even though errors are occurred:

- `pnpm fix`
- `pnpm typecheck`
- `pnpm test`
- `pnpm secretlint`

And then, if errors are found, please plan to fix them while analyzing the errors and related files. Then, please report the occurred errors and your plan.

On the other hand, if errors are not found, please report all successes.
