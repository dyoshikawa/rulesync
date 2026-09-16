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

`draft-release.yml` runs the `opencode` CLI through inline steps rather than the `anomalyco/opencode/github` composite wrapper. The steps mirror the wrapper (resolve the latest release tag, `actions/cache` the binary, install, run `opencode github run` with `MODEL` / `PROMPT` / `SHARE` / `USE_GITHUB_TOKEN` as environment variables), so every action the job uses is SHA-pinned; the wrapper referenced `actions/cache@v4` by mutable tag, which was also the last Node 20 action in this repository. Do not reintroduce the wrapper without checking that its nested actions are still SHA-pinnable and on a supported Node runtime.

The CLI binary itself is still not pinned: the install step resolves the release to `latest` at run time and installs it with `curl -fsSL https://opencode.ai/install | bash`, so the binary that actually receives the workflow secrets is not covered by any SHA.

The accepted stance is to treat `https://opencode.ai/install` as a trusted install path rather than vendoring a pinned installer, because `draft-release.yml` is `workflow_dispatch`-only and gated on `github.actor`, so an outside contributor cannot trigger it.

The residual risk this stance accepts is that a compromise of the distribution endpoint would expose whatever the workflow hands the CLI — the model API keys and a `GITHUB_TOKEN` with `contents: write`, `pull-requests: write`, and `issues: write`. The `github.actor` gate limits _who can trigger_ the workflow; it does not reduce that exposure on a maintainer-triggered run. Revisit this if the workflow ever becomes externally triggerable, if the token or secret scope it receives grows, or if pinning the CLI through the installer's `--version` flag becomes worthwhile.

## OIDC Permissions

Grant `id-token: write` only to jobs that actually perform an OIDC token exchange. `opencode github run` skips OIDC entirely when `USE_GITHUB_TOKEN=true`, so a job running it that way must not request `id-token: write`.
