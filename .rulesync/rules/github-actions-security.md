---
root: false
localRoot: false
targets:
  - "*"
description: Guidelines to avoid GitHub Actions script injection vulnerabilities.
globs:
  - ".github/workflows/*.yml"
---

# GitHub Actions Security: Script Injection

When working with GitHub Actions workflows, ensure that untrusted inputs are never interpolated directly into `run` scripts or other execution contexts. Follow GitHub's guidance on avoiding script injection vulnerabilities.

- Do not use expressions that inject untrusted inputs into shell commands (for example, `run: echo ${{ inputs.name }}` or `run: echo ${{ github.event.issue.title }}`)
- Prefer passing untrusted data through environment variables and reference them safely within scripts
- Use explicit quoting and safe parameter handling
- Validate or sanitize inputs before use when feasible

Reference: https://docs.github.com/ja/actions/concepts/security/script-injections
