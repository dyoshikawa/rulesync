# Qwen Code Map

Qwen Code keeps everything under one `.qwen/` tree at two writable scopes — the
workspace `<repo>/.qwen/` and the user `~/.qwen/` — with a system tier above
both that only `settings.json` uses. Three dimensions (`mcp`, `hooks`,
`permissions`) share that single layered `settings.json` rather than owning a
file each, so generation merges into it instead of overwriting; check the
per-surface rows before assuming a dimension has its own file. Rules are the
exception in the other direction: `QWEN.md` sits at the repository root, not
inside `.qwen/`.

Every row below was re-verified against the `v0.23.0` docs and source. Earlier
revisions of this map recorded `commands`, `subagents` and `hooks` as having no
upstream surface and no Rulesync target; all three claims were false, and the
Collect step reads those exact sentinel phrases as "upstream has nothing here",
so they were steering research runs away from three implemented dimensions.

## Official Docs

| Feature       | Official docs                                                                 | Upstream surface                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://qwenlm.github.io/qwen-code-docs/en/`                                 | Qwen Code documentation index                                                                                                                                                                                                       |
| settings      | `https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/`    | The exhaustive `settings.json` key table — the primary source for every `tools.*` / `security.*` / `permissions.*` key, and the first page to check for a new one                                                                   |
| `rules`       | `https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/`           | Context files such as `QWEN.md`, plus the personal `QWEN.local.md` overlay (v0.16.2), hierarchical instructional context                                                                                                            |
| `ignore`      | `https://qwenlm.github.io/qwen-code-docs/en/users/configuration/qwen-ignore/` | `.qwenignore`, `context.fileFiltering.respectQwenIgnore`                                                                                                                                                                            |
| `mcp`         | `https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/`              | `mcpServers` inside `settings.json` at either scope. There is **no documented project-root `.mcp.json`** — re-checked at `v0.23.0` and `main`, which is the unmet deferral condition of #2525                                       |
| `commands`    | `https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/`         | `<project>/.qwen/commands/*.md` (higher precedence) and `~/.qwen/commands/*.md`; a nested directory becomes a `:`-namespaced command (`.qwen/commands/git/commit.md` → `/git:commit`)                                               |
| `subagents`   | `https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/`       | `<project>/.qwen/agents/*.md` (highest precedence) and `~/.qwen/agents/*.md`; Claude Code agent files are accepted in the same directory, including a per-agent `hooks` record. Project-only `.qwen/fork-profiles/*.md` is separate |
| `skills`      | `https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/`           | `<project>/.qwen/skills/<name>/SKILL.md` and `~/.qwen/skills/<name>/SKILL.md`. Generated skills are namespaced (`auto-skill-*`, `learned-skill-*`) and are tool-managed — never a Rulesync output                                   |
| `hooks`       | `https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/`            | A `hooks` block in the layered `settings.json` at either scope; PascalCase event names, matcher-aware on the tool events                                                                                                            |
| `permissions` | `https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/`    | `permissions.allow` / `ask` / `deny` plus the `tools` and `security` groups of `settings.json`; approval mode and tool approval controls                                                                                            |
| `checks`      | `https://qwenlm.github.io/qwen-code-docs/en/users/features/code-review/`      | `<project>/.qwen/review-rules.md` — the native review-guidance file `/review` reads first. See below                                                                                                                                |

`checks` is **`unsupported`**: there is no `qwencode-check.ts` adapter, so
`.qwen/review-rules.md` cannot be authored from `.rulesync/`. The row is listed
so a run does not mistake the absence of a row for the absence of an upstream
surface. The same page also documents `.qwen/review-context.json` (a bounded
JSON guidance manifest) and the tool-managed `.qwen/tmp/`, `.qwen/review-cache/`
and `.qwen/reviews/` by-product directories, none of which Rulesync writes.

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| paths         | `qwencode-paths.ts` — the `.qwen/` subdirectories, `QWEN.md` / `QWEN.local.md`, `.qwenignore` and `settings.json`                                                                                                                       |
| `rules`       | Qwen context-file conversion and target gating in `qwencode-rule.ts`                                                                                                                                                                    |
| `ignore`      | `.qwenignore` passthrough in `qwencode-ignore.ts`                                                                                                                                                                                       |
| `mcp`         | `qwencode-mcp.ts` merges the `mcpServers` block into `settings.json` at either scope                                                                                                                                                    |
| `commands`    | `.qwen/commands/*.md` (project) and `~/.qwen/commands/*.md` (global) in `qwencode-command.ts`                                                                                                                                           |
| `subagents`   | `.qwen/agents/*.md` at both scopes in `qwencode-subagent.ts`                                                                                                                                                                            |
| `skills`      | `.qwen/skills/<name>/SKILL.md` at both scopes in `qwencode-skill.ts`                                                                                                                                                                    |
| `hooks`       | `qwencode-hooks.ts` merges the `hooks` block into `settings.json`; the canonical events map onto the PascalCase set in `QWENCODE_HOOK_EVENTS` (`src/types/hooks.ts`), which tracks the upstream list release by release                 |
| `permissions` | `qwencode-permissions.ts` — `permissions.allow` / `ask` / `deny` mapping and tool aliases, plus the curated `QWEN_OVERRIDE_TOOLS_KEYS` / `QWEN_OVERRIDE_SECURITY_KEYS` allow-lists and the `QWEN_SCOPED_*_KEYS` scope rules beside them |
| `checks`      | No target. `.qwen/review-rules.md` is unauthorable — see #2668                                                                                                                                                                          |

### Adding a `tools` / `security` key

`QWEN_OVERRIDE_TOOLS_KEYS` and `QWEN_OVERRIDE_SECURITY_KEYS` are **curated
allow-lists on the import path**: a key missing from them is silently dropped
from `.rulesync/permissions.jsonc` on `import`, even though `generate` spreads
the user's existing block and so preserves a hand-written one. That asymmetry is
where an unnoticed upstream addition turns into data loss on an import →
generate round trip, so re-read the settings table above when supporting a new
version.

Each key also needs an entry in the matching `QWEN_SCOPED_*_KEYS` map — the type
is a total `Record`, so the compiler enforces it. Pick the rule from upstream's
own `WORKSPACE_RESTRICTED_SETTINGS` and `WORKSPACE_NON_OVERRIDING_SETTINGS` in
`packages/cli/src/config/settingsUtils.ts`, not from the prose on the docs page;
a key absent from both lists is honored in any scope (`global-machine-wide`).
