---
description: 'Execute `pnpm cicheck:code` and fix any failures if exists.'
targets:
  - '*'
---

Do the following actions and fix any failures if exists. Until all pass successfully, do the following actions again.

```
pnpm cicheck:code
```

When finished, execute `git commit` and `git push`.
