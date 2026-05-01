# RuleSync Plugins V1 Design

Date: 2026-05-01
Status: Proposed
Scope: RuleSync core

## Summary

Add `plugins` as a first-class RuleSync feature alongside `skills`, `commands`, `subagents`, `mcp`, `hooks`, and `permissions`.

V1 targets `codexcli` first, but the design must remain generic enough to support `claudecode` and `geminicli` later.

The core design decisions are:

- `plugins` is a first-class feature in RuleSync config and lifecycle.
- External plugin declarations live in `rulesync.jsonc` `sources[]`.
- Local plugin definitions live in `.rulesync/plugins/`.
- The source model is explicit and declarative. RuleSync does not discover plugin manifests from arbitrary repos by convention alone.
- `rulesync install` is the canonical operation for plugin installation.
- `rulesync generate` remains focused on generated project artifacts and may be a no-op for `codexcli/plugins` in V1.
- Plugin deployment state gets a dedicated lockfile rather than overloading `rulesync.lock`.

## Existing Architecture Findings

- RuleSync is organized around first-class `targets` and `features`.
- `features` is a closed enum today and drives CLI, config resolution, docs, and generation dispatch.
- `sources[]` already exists as a config-file-only declarative install surface.
- RuleSync already separates two planes:
  - `generate`: emit tool-native files from `.rulesync/*`
  - `install`: resolve/fetch/deploy external assets and maintain lock state
- Codex CLI already has target-specific handling and merge-oriented behavior for files like `.codex/config.toml`.
- RuleSync already has a curated-vs-local precedence model for `skills`:
  - local `.rulesync/skills/*`
  - curated `.rulesync/skills/.curated/*`
  - local wins

These patterns are sufficient to add `plugins` without bolting on a separate subsystem.

## Rejected Designs

### 1. Generate-only plugins

Rejected because plugin installation is not equivalent to generating project files, especially for `codexcli`.

### 2. Raw passthrough manifests

Rejected because it would weaken RuleSync's source-of-truth model. RuleSync should validate and normalize plugin packages rather than becoming a thin copier of arbitrary target-native files.

### 3. New primary object-form `targets`

Rejected for V1 because it would unnecessarily disrupt existing configs that already rely on:

```jsonc
{
  "targets": ["cursor", "claudecode", "codexcli", "geminicli", "antigravity"],
  "features": ["skills", "commands", "subagents", "mcp", "hooks"],
}
```

## Final V1 Config Model

### Top-level feature enablement

Users enable `plugins` like any other feature:

```jsonc
{
  "targets": ["cursor", "claudecode", "codexcli", "geminicli", "antigravity"],
  "features": ["skills", "commands", "subagents", "mcp", "hooks", "plugins"],
}
```

### Per-target override

V1 introduces `targetFeatures` as a simple override map:

```jsonc
{
  "targets": ["cursor", "claudecode", "codexcli", "geminicli", "antigravity"],
  "features": ["skills", "commands", "subagents", "mcp", "hooks"],
  "targetFeatures": {
    "codexcli": ["skills", "mcp", "plugins"],
  },
}
```

Semantics:

- `targets` defines the global tool set.
- `features` defines the default feature set for those targets.
- `targetFeatures.<tool>` replaces the feature set for that tool.
- No merge behavior.
- No additive or subtractive syntax.

Effective result for the example above:

- `cursor`, `claudecode`, `geminicli`, `antigravity` use `["skills", "commands", "subagents", "mcp", "hooks"]`
- `codexcli` uses `["skills", "mcp", "plugins"]`

This preserves the current mental model while allowing selective rollout of `plugins`.

## Plugin Source Model

Plugin declarations are explicit in `sources[]`.

Example:

```jsonc
{
  "sources": [
    {
      "source": "obra/superpowers",
      "ref": "main",
      "plugins": [
        {
          "name": "superpowers",
          "targets": ["codexcli"],
          "codexcli": {
            "artifact": {
              "kind": "skillsBundle",
              "path": "skills",
            },
            "install": {
              "strategy": "userSkillsDir",
            },
          },
        },
      ],
    },
  ],
}
```

### Why explicit declarations

- Different repos expose different target artifacts.
- The same repo may expose Codex, Claude, and Gemini artifacts in different shapes and paths.
- RuleSync must not guess which remote files represent a plugin package.

`sources[]` remains the source of truth for external dependencies.

## Local Plugin Model

Local plugins live in `.rulesync/plugins/<name>/`.

Each local plugin contains a manifest:

```text
.rulesync/plugins/superpowers/plugin.jsonc
```

Example local manifest:

```jsonc
{
  "name": "superpowers",
  "targets": ["codexcli"],
  "codexcli": {
    "artifact": {
      "kind": "skillsBundle",
      "path": "skills",
    },
    "install": {
      "strategy": "userSkillsDir",
    },
  },
}
```

Optional payload files may live adjacent to the manifest, for example:

```text
.rulesync/plugins/superpowers/skills/...
```

## Normalized Plugin Contract

RuleSync plugin packages are normalized and target-aware.

Minimum V1 fields:

- `name`
- `targets`
- per-target configuration blocks such as `codexcli`

Per-target configuration includes:

- `artifact.kind`
- `artifact.path`
- `install.strategy`

V1 intentionally uses a small closed set of types.

### V1 Codex types

Artifact kinds:

- `skillsBundle`

Install strategies:

- `userSkillsDir`

This is intentionally narrow. V1 is not a generic arbitrary installer.

## Precedence Rules

Precedence mirrors curated skills:

1. local plugin package in `.rulesync/plugins/<name>/`
2. curated external plugin package in `.rulesync/plugins/.curated/<name>/`
3. first-declared source wins among curated packages

This keeps RuleSync behavior predictable and consistent with existing source handling.

## Curated Storage Layout

External plugin packages are materialized under:

```text
.rulesync/plugins/.curated/<name>/
```

This mirrors `.rulesync/skills/.curated/` and keeps the fetched package inspectable for:

- debugging
- audits
- future Atlas visualization
- deterministic local installs

## Installation Lifecycle

### Canonical operation

`rulesync install` is the canonical plugin operation.

For V1, install should support target filtering just like generation:

```bash
rulesync install --targets codexcli
```

Install behavior:

1. Read config and resolve effective features per target, including `targetFeatures`.
2. Filter to targets where `plugins` is enabled.
3. Read `sources[]` and local plugin packages.
4. Fetch external plugin packages into `.rulesync/plugins/.curated/`.
5. Resolve local-vs-curated precedence.
6. Install compatible plugin packages into the real target environment.
7. Update plugin lock state.

### Generate behavior

`rulesync generate` remains focused on generated project artifacts.

For `codexcli/plugins` in V1:

- generation may be a no-op
- RuleSync should report that this feature is install-managed for the target

This is preferable to pretending that plugin generation alone equals installation.

## What "Installed" Means For Codex V1

For `codexcli`, "installed" means the plugin payload has been deployed into the Codex environment in the location required by Codex.

For the `superpowers` V1 test case, RuleSync should:

- fetch the declared package from `obra/superpowers`
- normalize the package into curated plugin storage
- deploy the Codex-compatible skill bundle to the Codex user skills directory
- track deployed files in the plugin lock

RuleSync should not execute upstream install scripts or arbitrary shell instructions from the plugin repository.

## Locking And State

V1 should introduce a dedicated lockfile:

```text
rulesync-plugins.lock.yaml
```

Reason:

- `rulesync.lock` currently tracks source resolution for curated skills
- plugin installation needs target-aware deployment state
- plugin state is closer to `gh` install mode than to curated skill fetch state

Minimum lock information per installed plugin:

- source
- plugin name
- requested ref
- resolved commit
- target
- scope
- install strategy
- deployed files
- content hash
- install timestamp

## Codex V1 Scope Choice

V1 for `codexcli` should support end-to-end ownership by RuleSync:

- acquisition
- update
- curated materialization
- deployment
- lock tracking

But only through controlled RuleSync install strategies.

RuleSync must not become a remote script runner.

## Unsupported Targets Behavior

When `plugins` is enabled for a target that has no plugin adapter yet:

- warn clearly
- skip safely
- do not fail the entire command unless the user requested a strict mode in the future

This matches existing feature-target support behavior in RuleSync generation.

## V1 Out Of Scope

- reverse import of installed plugins into `.rulesync/plugins/`
- direct plugin conversion between targets
- automatic discovery of plugin packages in undeclared repos
- execution of remote install scripts
- support for arbitrary artifact and install types
- full `claudecode` and `geminicli` support in the first implementation

## Minimum Module Impact

Likely modules to change:

- config schema and resolution
- feature enum and CLI help
- install command filtering
- constants for plugin directories and lockfile names
- new plugin loader, curated fetcher, installer, and lock modules
- docs and supported-feature matrices

Likely new module families:

- `src/features/plugins/*`
- `src/lib/plugins/*`

## Phased Implementation Plan

1. Add `plugins` to feature enums, CLI help, docs, and warnings.
2. Add `targetFeatures` to config resolution with override semantics.
3. Add plugin constants and local package layout.
4. Add `sources[].plugins[]` schema.
5. Add curated external plugin fetch/materialization.
6. Add plugin precedence resolution.
7. Add `rulesync-plugins.lock.yaml`.
8. Add `codexcli` plugin installer with `skillsBundle -> userSkillsDir`.
9. Validate against `obra/superpowers`.

## Open Product Questions Deferred Beyond V1

- whether plugin install should later support strict check mode
- whether plugin generation should exist for targets with project-scoped plugin manifests
- how `claudecode` and `geminicli` should map their native plugin/extension artifacts into RuleSync install strategies
