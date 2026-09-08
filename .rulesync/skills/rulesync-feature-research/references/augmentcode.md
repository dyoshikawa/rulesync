# AugmentCode Map

Auggie CLI (`@augmentcode/auggie`) keeps everything under one `.augment/` tree at
two writable scopes — the workspace `<repo>/.augment/` and the user
`~/.augment/` — above a read-only system tier that only `settings.json` uses
(see the `hooks` row). Three of the nine dimensions (`mcp`, `hooks`,
`permissions`) — plus the plugin-consumption keys, which are not a dimension at
all — share that single layered `settings.json` rather than having a file each,
so generation merges into it instead of overwriting; check the per-surface rows
before assuming a dimension owns its own file. Auggie also resolves commands,
subagents and skills over the cross-tool `.agents/` and `.claude/` roots —
`.agents/` for skills and subagents since 0.16.0, while the `.claude/`
compatibility roots are documented unversioned on `/cli/custom-commands` and
`/cli/skills`. Rulesync reads only the `.agents/` roots on import (there is no
`.claude/` path constant in the AugmentCode adapters) and always generates into
`.augment/`.

## Official Docs

| Feature       | Official docs                                                      | Upstream surface                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.augmentcode.com/`                                    | Augment documentation index                                                                                                                                                                                                                                             |
| `rules`       | `https://docs.augmentcode.com/cli/rules`                           | `.augment/rules`, `~/.augment/rules`, AGENTS.md and CLAUDE.md hierarchical rules                                                                                                                                                                                        |
| `ignore`      | `https://docs.augmentcode.com/cli/setup-auggie/workspace-indexing` | `.augmentignore`, `.gitignore` interaction, workspace indexing filters                                                                                                                                                                                                  |
| `mcp`         | `https://docs.augmentcode.com/cli/integrations`                    | `mcpServers` inside `settings.json` (there is no `.augment/mcp.json`); the docs show only `~/.augment/settings.json`, plus the transient `--mcp-config` override and `auggie mcp add`. **`/cli/mcp` 404s — do not cite it.**                                            |
| `commands`    | `https://docs.augmentcode.com/cli/custom-commands`                 | `.augment/commands/*.md` (workspace), `~/.augment/commands/*.md` (user); Markdown with optional frontmatter. Also resolved over `.claude/commands` and `.agents/commands` at both scopes                                                                                |
| `subagents`   | `https://docs.augmentcode.com/cli/subagents`                       | `.augment/agents/*.md` (workspace) and `~/.augment/agents/*.md` (user); YAML frontmatter `name` (required), `description`, `color`, `model`, `tools`, `disabled_tools` — `disabled_tools` wins when both are set                                                        |
| `skills`      | `https://docs.augmentcode.com/cli/skills`                          | agentskills.io `<name>/SKILL.md` bundles under `.augment/skills/`, `.claude/skills/`, `.agents/skills/` and their `~` equivalents; `name` (1–64 chars, lowercase/digits/hyphens) and `description` required; `~/.augment/skills/` has the highest precedence            |
| `hooks`       | `https://docs.augmentcode.com/cli/hooks`                           | A `hooks` block in the layered `settings.json` (`/etc/augment/` or `%ProgramData%\Augment\`, `<workspace>/.augment/settings.local.json`, `<workspace>/.augment/settings.json`, `~/.augment/settings.json`); PascalCase events, `PreToolUse`/`PostToolUse` matcher-aware |
| `permissions` | `https://docs.augmentcode.com/cli/permissions`                     | `toolPermissions` in `settings.json` at either scope; `allow`/`deny`/`ask-user`, first-match-wins rules                                                                                                                                                                 |
| `checks`      | `https://docs.augmentcode.com/codereview/review-guidelines`        | `<repo-root>/.augment/code_review_guidelines.yaml` — project scope only; top-level `areas` (each with `description`, `globs`, `rules[{id, description, severity}]`) plus an optional `file_paths_to_ignore`; severity is `high` / `medium` / `low`                      |
| `plugins`     | `https://docs.augmentcode.com/cli/plugins`                         | Plugin bundles (`.augment-plugin/plugin.json`, `.augment-plugin/marketplace.json`, `commands/`, `agents/`, `rules/`, `skills/`, `hooks/hooks.json`, `.mcp.json`; `.claude-plugin/` accepted for compatibility) and four consumption keys — see below                    |

`plugins` is **not a Rulesync dimension and has no AugmentCode target** — it is
listed so a run does not mistake the absence of a row for the absence of an
upstream surface. Both halves are `unsupported`: the bundle side (tracked as the
`augmentcode-plugin` proposal) and the consumption keys `recommendedMarketplaces`
(project only), `enabledPlugins` (any tier, deep-merged), `autoUpdateMarketplaces`
(user) and `dismissedMarketplaces` (`settings.local.json`, tool-managed), none of
which Rulesync can author. See #2959.

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| paths         | `augmentcode-paths.ts` — the `.augment/` roots, the `.agents/` import-only discovery roots, `settings.json` / `settings.local.json`, and `code_review_guidelines.yaml`                                                                                            |
| `rules`       | `.augment/rules` non-root conversion and frontmatter stripping in `augmentcode-rule.ts`; the still-supported root `.augment-guidelines` in `augmentcode-legacy-rule.ts`, which `/cli/rules` still lists below `CLAUDE.md`/`AGENTS.md` and above `.augment/rules/` |
| `ignore`      | `.augmentignore` passthrough and gitignore-compatible comments in `augmentcode-ignore.ts`                                                                                                                                                                         |
| `mcp`         | `augmentcode-mcp.ts` merges the `mcpServers` block into `settings.json` at either scope and never deletes the file; project import overlays the gitignored `settings.local.json`                                                                                  |
| `commands`    | `.augment/commands/*.md` (project) and `~/.augment/commands/*.md` (global) emitted in `augmentcode-command.ts`; `.agents/commands/` is read on import only                                                                                                        |
| `subagents`   | `.augment/agents/*.md` at both scopes in `augmentcode-subagent.ts`; `.agents/` is an import-only discovery root                                                                                                                                                   |
| `skills`      | `.augment/skills/<name>/SKILL.md` at both scopes in `augmentcode-skill.ts`; `.agents/skills/` is an import-only discovery root                                                                                                                                    |
| `hooks`       | `augmentcode-hooks.ts` merges the `hooks` block into `settings.json`; seven canonical events map onto the PascalCase set — see `AUGMENTCODE_HOOK_EVENTS` in `types/hooks.ts` (`PromptSubmit` ← `beforeSubmitPrompt`, added upstream in 0.27.0)                    |
| `permissions` | `.augment/settings.json`, `toolPermissions`, tool-name aliases, regex/glob fallback, and fail-closed ordering in `augmentcode-permissions.ts`                                                                                                                     |
| `checks`      | `.augment/code_review_guidelines.yaml` in `augmentcode-check.ts`; canonical `critical` folds one-way into Augment's `high`, and an unannotated check defaults to `medium`                                                                                         |
| `plugins`     | No target. `src/types/tool-targets.ts` lists only `antigravity-plugin` and `claudecode-plugin`; Auggie reads `.claude-plugin/` too, so the existing `claudecode-plugin` output is already partly consumable                                                       |
