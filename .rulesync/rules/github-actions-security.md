---
root: false
localRoot: false
targets:
  - "*"
description: Security guidelines for GitHub Actions workflows (script injection, third-party action pinning, OIDC permissions).
globs:
  - ".github/workflows/*.yml"
agentsmd:
  subprojectPath: ".github/workflows"
---

# GitHub Actions Security

## Script Injection

When working with GitHub Actions workflows, ensure that untrusted inputs are never interpolated directly into `run` scripts or other execution contexts. Follow GitHub's guidance on avoiding script injection vulnerabilities.

- Do not use expressions that inject untrusted inputs into shell commands (for example, `run: echo ${{ inputs.name }}` or `run: echo ${{ github.event.issue.title }}`)
- Prefer passing untrusted data through environment variables and reference them safely within scripts
- Use explicit quoting and safe parameter handling
- Validate or sanitize inputs before use when feasible

Reference: https://docs.github.com/ja/actions/concepts/security/script-injections

## Third-Party Action Pinning

Third-party GitHub Actions are pinned to a full 40-character commit SHA with a trailing `# vX.Y.Z` comment. Keep that convention when adding or bumping an action.

`anomalyco/opencode/github` (used by `draft-release.yml`) is a composite action, so its SHA pin covers the wrapper only:

- The wrapper resolves the `opencode` CLI release to `latest` at run time and installs it with `curl -fsSL https://opencode.ai/install | bash`, so the binary that actually receives the workflow secrets is not pinned by the SHA.
- The wrapper also uses `actions/cache@v4` internally, by mutable tag.

The accepted stance is to treat `https://opencode.ai/install` as a trusted install path rather than vendoring a pinned installer, because `draft-release.yml` is `workflow_dispatch`-only and gated on `github.actor`, so an outside contributor cannot trigger it. Bumping the pin is still worthwhile for the wrapper itself, but do not read it as a guarantee about the CLI version. Revisit this if the workflow ever becomes externally triggerable, or if upstream adds a `version` input that lets the CLI itself be pinned.

## OIDC Permissions

Grant `id-token: write` only to jobs that actually perform an OIDC token exchange. `anomalyco/opencode/github` skips OIDC entirely when it is given `use_github_token: "true"`, so a job using that input must not request `id-token: write`.
