---
root: false
localRoot: false
targets:
  - "*"
description: Security guidelines for GitHub Actions workflows (script injection, third-party action pinning, OIDC permissions).
globs:
  - ".github/workflows/*.yml"
  - ".github/actions/**/*.yml"
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

`draft-release.yml` pins the `anomalyco/opencode/github` composite action to the SHA for `github-v1.2.28` because that version pins its internal `actions/cache` dependency to a full SHA (v4.3.0). Newer 1.x releases still contain `github/action.yml`, but use the mutable `actions/cache@v4` tag. Dependabot ignores this dependency to avoid silently reintroducing that unpinned action; do not update the wrapper without checking its transitive action references.

The wrapper still resolves the `opencode` CLI from the unauthenticated GitHub `releases/latest` API response at run time and installs it with `curl -fsSL https://opencode.ai/install | bash`. The installer endpoint and the `anomalyco/opencode` GitHub Releases artifacts are therefore separate trust boundaries not covered by the composite-action SHA or its cache pin. Secrets passed through the composite action's `env` are available to **every** step, including the downloaded installer script, not only the eventual CLI binary.

The accepted stance is to trust this runtime distribution path because `draft-release.yml` is `workflow_dispatch`-only and restricts `github.actor` to maintainers. That gate limits **who can trigger** the workflow; it does **not** reduce exposure during a maintainer-triggered run.

The residual risk is that compromised install infrastructure or release artifacts could expose the model API keys, the `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`, `issues: write`), and the job's OIDC token-request capability (`id-token: write`). Revisit this decision if the workflow becomes externally triggerable, gains broader secrets or permissions, or a self-managed installation becomes practical. The alternative is to replace the frozen composite wrapper with a pinned, checksum-verified opencode 1.x CLI installation and invoke `opencode github run` directly.

## cicd-sensor (Takumi Runner)

`.github/actions/cicd-sensor` starts an eBPF runtime sensor at the top of `publish.yml`, `publish-assets.yml`, `draft-release.yml` and `security-scan.yml` and ships the job's process, file-path and network trace to Takumi Runner (GMO Flatt Security). It is dormant until the repository variable `SHISHO_BOT_ID` is set. Two distinct parties are trusted here: `cicd-sensor/cicd-sensor` (an independent open-source project) supplies the agent that runs as root, and Flatt receives the traces and pushes the detection rules and output settings.

`cicd-sensor/cicd-sensor-action` is a JS wrapper, so its SHA pin covers only the wrapper: at run time it downloads the agent tarball for its `cicd-sensor-version` input from a mutable GitHub Release, installs it with `sudo` and starts it as a root systemd unit, and it does not verify the download. The composite action closes that gap itself, and the following invariants must survive any edit to it:

- `CICD_SENSOR_VERSION` is passed to the action explicitly, so a Dependabot bump of the action pin (whose default version may move) never runs an agent that was not verified.
- Before the action runs, the same tarball is downloaded and checked twice: `cosign verify-blob` against the release's sigstore bundle proves it was built by `cicd-sensor/cicd-sensor`'s release workflow, and the pinned `CICD_SENSOR_TARBALL_SHA256` / `CICD_SENSOR_AGENT_SHA256` prove it is the exact artifact that was reviewed. Identity alone would accept any future rebuild signed from a compromised upstream `main`; the digests alone would accept nothing else, but say nothing about who built it.
- After the action installs `/usr/local/bin/cicd-sensor`, its digest is compared with the verified agent binary, which closes the window between the two downloads. The check also runs when the action failed part-way, because the agent may already be running by then.
- Availability failures fail open (sign-in, cosign install, Sigstore trust root or download failing warns and skips tracing); integrity failures fail closed (a bad signature or a digest mismatch stops the job before any later step runs — the agent is already running as root at the post-install check, so what the check guarantees is that nothing after it executes, not that the agent never started). For that reason the callers must not wrap the composite step in `continue-on-error`.

Dependabot bumps the action pins in `.github/actions/cicd-sensor` (it has its own entry, because the root `github-actions` entry only scans `.github/workflows/`), but never `CICD_SENSOR_VERSION` or the digests. To bump the agent: download the new tarball and its `.sigstore.json`, run the same `cosign verify-blob` command, record the tarball digest from the release's `checksums.txt` and the digest of the extracted `cicd-sensor-linux-amd64`, and re-check the `--certificate-identity` against the new bundle's certificate (a release signed from a tag ref instead of `refs/heads/main` needs the identity updated too).

The residual risk this accepts: the agent runs as root with eBPF and ptrace capabilities in jobs that hold the npm trusted-publishing OIDC token, the release attestation signing identity and the security-scan API keys, so a compromise of `cicd-sensor/cicd-sensor`'s release workflow that also passes the digest check (that is, one made before the digests were pinned) would expose all of them. Flatt controls the detection rules, including `terminate` actions that can stop a release job mid-way, and the `redact_process_args` output setting; neither is controllable from this repository. Revisit this if upstream starts verifying its own download, if the traced jobs gain new secrets, or if secrets ever start travelling on a command line instead of the environment.

## OIDC Permissions

Grant `id-token: write` only to jobs that actually perform an OIDC token exchange. `draft-release.yml` and `security-scan.yml` carry it for the cicd-sensor sign-in (`flatt-security/shisho-cloud-action` exchanges the GitHub OIDC token for a Takumi trace-sender token); `publish.yml` and `publish-assets.yml` already had it for npm trusted publishing and release attestations. `anomalyco/opencode/github` itself still skips OIDC when it is given `use_github_token: "true"`, so its presence in `draft-release.yml` is not a reason for that permission, and the permission should go away if the sensor does. Because `id-token: write` is job-wide, every step in those jobs can mint an OIDC token, which is why `security-scan.yml` installs with `--ignore-scripts` like the other workflows; keep the bot's OIDC trust condition on the Takumi side scoped to the specific `job_workflow_ref`s rather than the whole repository.
