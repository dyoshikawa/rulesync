# Factory Droid Map

The `droid` CLI keeps everything under one `.factory/` tree at two authored
scopes — the project `<repo>/.factory/` and the user `~/.factory/`. Factory's
documentation moved in 2026: the old `/cli/configuration/*` and
`/reference/hooks-reference` paths now 308-redirect to `/harness/*` and
`/droid-cli/*`, so cite the canonical URLs below rather than the redirecting
ones. Two upstream surfaces are worth keeping in view when reading the table:
Factory documents **seven** settings levels (Org, Runtime, Folder, Project,
User, Dynamic, BuiltIn) of which four are authored, and the Folder level is a
per-subtree `.factory/` inside a monorepo carrying the full set of files —
Rulesync writes one project root and one home root and has no per-subdirectory
output root, so that level is out of reach by design rather than by oversight.

## Official Docs

| Feature       | Official docs                                                              | Upstream surface                                                                                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.factory.ai/droid-cli/quickstart`                             | Factory Droid CLI documentation                                                                                                                                                                                                                                                 |
| `rules`       | `https://docs.factory.ai/harness/agents-md`                                | `AGENTS.md` at the repo root, nested `AGENTS.md`, personal `~/.factory/AGENTS.md`, and the separate `DESIGN.md` architecture document                                                                                                                                           |
| `ignore`      | No dedicated upstream ignore surface in map                                | Factory documents no `.droidignore` / `.factoryignore` equivalent; no Rulesync-supported Factory Droid ignore target                                                                                                                                                            |
| `mcp`         | `https://docs.factory.ai/harness/mcp`                                      | `.factory/mcp.json` (project) and `~/.factory/mcp.json` (user); stdio and HTTP servers                                                                                                                                                                                          |
| `commands`    | `https://docs.factory.ai/harness/custom-slash-commands`                    | `.factory/commands/` and `~/.factory/commands/`; `description` and `argument-hint` frontmatter only — "Tool scoping is not available for custom commands"                                                                                                                       |
| `subagents`   | `https://docs.factory.ai/harness/subagents`                                | Custom droids as `.factory/droids/<name>.md` and `~/.factory/droids/<name>.md`. (`/cli/configuration/custom-droids` and `/harness/custom-droids` both redirect here.)                                                                                                           |
| `skills`      | `https://docs.factory.ai/harness/skills`                                   | `.factory/skills/<name>/SKILL.md` and `~/.factory/skills/<name>/SKILL.md`; `skill.mdx` supporting files; invocation controls; also discovered at the folder scope                                                                                                               |
| `hooks`       | `https://docs.factory.ai/harness/hooks`                                    | `.factory/hooks.json` and `~/.factory/hooks.json` (legacy `settings.json` fallback); nine events — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`; matcher groups; command-type hooks only |
| `permissions` | `https://docs.factory.ai/droid-cli/settings`                               | `settings.json` at either scope: `commandAllowlist` / `commandDenylist` / `commandBlocklist`, autonomy, sandbox, network and MCP policy keys                                                                                                                                    |
| `checks`      | `https://docs.factory.ai/software-factory/code-review-ci`                  | `.factory/skills/review-guidelines/SKILL.md` — review guidance delivered as a reserved skill directory rather than its own config file                                                                                                                                          |
| threat model  | `https://docs.factory.ai/software-factory/security-review`                 | `.factory/threat-model.md` — "if `.factory/threat-model.md` exists, Droid uses it as the attack-surface map" for Security Review; documented only as a repository file, no home-directory equivalent                                                                            |
| org settings  | `https://docs.factory.ai/enterprise/hierarchical-settings-and-org-control` | The seven settings levels and the org-delivered `settings.json` keys, including `builtInToolAutonomyOverrides`, `mcpAutonomyUrlOverrides`, `allowManagedHooksOnly`, `strictEnabledPlugins`, `strictKnownMarketplaces`                                                           |
| output styles | `https://docs.factory.ai/droid-cli/output-styles`                          | `.factory/output-styles/<name>.md` and `~/.factory/output-styles/<name>.md`; `.md` only, no nesting; optional `name` / `description` frontmatter; selection persisted as the `outputStyle` setting; `Default` and `Concise` reserved — see below                                |
| `plugins`     | `https://docs.factory.ai/harness/plugins`                                  | Plugin bundles carrying `.factory-plugin/plugin.json` and `.factory-plugin/marketplace.json`, consumed through the `extraKnownMarketplaces` / `enabledPlugins` settings keys — see below                                                                                        |

Output styles are **not a Rulesync dimension and have no Factory Droid target**.
The surface is a committed, frontmatter-carrying, system-prompt-shaping
instruction channel in the same class as `AGENTS.md`, `DESIGN.md` and
`.factory/threat-model.md`, and
`FactorydroidRule.getSettablePaths` emits nothing under `.factory/output-styles/`.
Adding it would mean a directory-shaped `factorydroid.channel` value that carries
a style name, at both project and global scope. Tracked in #2957; the row exists
so a run does not read the missing row as a missing upstream surface.

`plugins` is likewise **not a Rulesync dimension and has no Factory Droid
target**. `src/types/tool-targets.ts` lists only `antigravity-plugin` and
`claudecode-plugin`. The consumption half is different: `extraKnownMarketplaces`
and `enabledPlugins` _are_ authorable, through the `factorydroid` permissions
override — see `FACTORYDROID_OVERRIDE_KEYS`.

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| paths         | `factorydroid-paths.ts` — the `.factory/` roots, `settings.json` / `settings.local.json`, and `FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH`                                                                                      |
| `rules`       | Project `AGENTS.md`, global `.factory/AGENTS.md`, the `.factory/rules` non-root path, and the `factorydroid.channel: design` / `threat-model` routes into `DESIGN.md` / `.factory/threat-model.md` in `factorydroid-rule.ts` |
| `mcp`         | `.factory/mcp.json`, stdio/HTTP server conversion, and project/global handling in `factorydroid-mcp.ts`                                                                                                                      |
| `commands`    | Native command files under `.factory/commands` in `factorydroid-command.ts`                                                                                                                                                  |
| `subagents`   | Native custom droids under `.factory/droids` in `factorydroid-subagent.ts`                                                                                                                                                   |
| `skills`      | Native skills under `.factory/skills` in `factorydroid-skill.ts`                                                                                                                                                             |
| `hooks`       | `.factory/hooks.json` (legacy `settings.json` fallback), Factory hook events, and matcher conversion in `factorydroid-hooks.ts`                                                                                              |
| `permissions` | `.factory/settings.json` and the `settings.local.json` overlay in `factorydroid-permissions.ts`; the tool-specific keys that round-trip through the override live in `factorydroid-settings-keys.ts`                         |
| `checks`      | `.factory/skills/review-guidelines/SKILL.md` in `factorydroid-check.ts`                                                                                                                                                      |
| output styles | No target. `FactorydroidRule.getSettablePaths` returns only `root`, `nonRoot`, `design` and `threatModel`                                                                                                                    |
| `plugins`     | No bundle target. The consumption keys `extraKnownMarketplaces` and `enabledPlugins` are carried in `FACTORYDROID_OVERRIDE_KEYS`                                                                                             |
