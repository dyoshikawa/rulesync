---
description: 'Reviewprompt'
targets:
  - claudecode
---

pr_url = $ARGUMENTS

If pr_url is not provided, please retrieve the PR associated with the current branch.

reviewprompt is a Node.js CLI tool that extracts instructions for you from GitHub PR review comments and outputs them as a single prompt.

Please execute as follows and make corrections according to the output instructions:

```bash
npx reviewprompt --resolve --all $pr_url
```
