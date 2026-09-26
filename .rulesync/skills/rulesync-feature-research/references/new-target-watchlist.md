# New-Target Watchlist

Products that are not Rulesync targets today but could become one. They are
recorded here rather than left in a research issue so a later
`research-tool-updates` run re-checks them instead of re-deriving them.

Each entry states the condition to re-check. When a condition is met, promote
the entry to a target proposal (a GitHub issue) and remove it from this file;
when the product is discontinued or the condition can no longer be met, retire
the entry the same way. An entry that is neither promoted nor retired stays.

| Candidate                                         | Recorded   | Re-check condition                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoo Code CLI (`@roo-code/cli`)                    | 2026-08-08 | Whether the package ships publicly; today it is `private: true`, unpublished and undocumented                                                                                                                                                                                                                                                                                 |
| ForgeCode (`tailcallhq/forgecode`)                | 2026-09-12 | Weekly npm downloads of `@antinomyhq/forge` reach ~2k or stars reach 10k, or an official docs page pins the `.forge/commands` YAML and `forge.yaml` schema (the docs site renders client-side today)                                                                                                                                                                          |
| Salesforce Agentforce Vibes (IDE + announced CLI) | 2026-09-12 | The official rules docs become reachable (403 to fetchers today) and the CLI ships a repo-level MCP / rules layout beyond `.a4drules/*.md`                                                                                                                                                                                                                                    |
| Verdent (VS Code extension + Verdent Deck)        | 2026-09-12 | A project-scope `.verdent/` tree or a CLI with documented config appears; today only `~/.verdent/{VERDENT.md,plan_rules.md,subagents/*.md}` plus `AGENTS.md` (covered)                                                                                                                                                                                                        |
| Baidu Comate / Zulu CLI (`@comate/zulu`)          | 2026-09-12 | English docs list the project-level file layout; today only `.baidu-comate/mcp.json` (IDE) is documented and the package is license-gated with ~290 downloads/week                                                                                                                                                                                                            |
| Warp Factories (definitions-as-code)              | 2026-09-12 | Not a `warp` gap (see #2598) — Factories leave Early Access (gated since 2026-08-18) or the `factory.yaml` / `agents/<name>/agent.md` / `skills/<name>/SKILL.md` tree becomes something a developer's own project repo carries rather than a separate factory repository                                                                                                      |
| fx (`vercel-labs/fx`)                             | 2026-09-16 | Project `.fx.json` or a `.fx/` tree gains rules / permissions / hooks, or stars reach ~10k; today the project file carries only `max_agent_steps` / `max_tool_result_bytes` / `context` and everything else is global-only under `~/.fx/` (`AGENTS.md`, `settings.json` permission map, `mcp.json`, `skills/`) while `AGENTS.md` / `.mcp.json` / `.agents/skills` are covered |
| Zencoder (IDE extension + Zenflow)                | 2026-09-16 | An official rules-file reference page appears for `.zencoder/rules/*.md` (`description`, `alwaysApply` / `always_apply`, `globs`) together with a file-based MCP / agents layout, or a standalone CLI ships; today MCP lives in the VS Code setting `zencoder.mcpServers` and agents are dashboard-managed                                                                    |
| Nanocoder (`Nano-Collective/nanocoder`)           | 2026-09-16 | Stars reach ~10k or `@nanocollective/nanocoder` downloads reach ~5k/week (2,476 stars and ~1.2k/week today); surface is `agents.config.json` in the cwd plus `~/.config/nanocoder/agents.config.json` with documented skills / commands / subagents / hooks                                                                                                                   |
| Every Code (`just-every/code`, Codex fork)        | 2026-09-16 | A project-scope `.code/` layout distinct from Codex appears, or stars reach ~10k (4,030 today); surface is `~/.code/config.toml` (Codex-shaped, also reads legacy `~/.codex/`) plus `AGENTS.md`, both covered by `codexcli` / `agentsmd`                                                                                                                                      |
| Open Interpreter (Rust Codex distribution)        | 2026-09-26 | GitHub release assets exceed ~10k downloads per release or a package channel exceeds ~2k/week, or it gains a rules / commands surface beyond Codex; today `.openinterpreter/config.toml` + `hooks.json` mirror the Codex layout already covered by `codexcli`                                                                                                                 |
| jcode (`1jehuang/jcode`)                          | 2026-09-26 | A project-scope rules / skills / permissions file beyond `.jcode/mcp.json` is documented (20,136 stars, v0.88.0 today)                                                                                                                                                                                                                                                        |

## Zoo Code CLI — `apps/cli` in the Zoo-Code repo

`https://github.com/Zoo-Code-Org/Zoo-Code` carries an `apps/cli` package
(`@roo-code/cli` v0.1.17, bin `roo`) that is `private: true`, unpublished, still
Roo-branded, and undocumented. It runs the same agent core against the same
`.roo/` assets the existing `roo` target already covers, so it is worth a new
target only if it ships publicly **and** introduces a CLI-only config surface.
Check the package's `private` flag and npm publication first; if it is public,
diff its config discovery against `references/roo.md`.

Re-checked 2026-08-17 and still unmet: `apps/cli/package.json` on the default
branch is unchanged, and `https://registry.npmjs.org/@roo-code%2Fcli` returns
`{"error":"Not found"}`. That 404 is conclusive rather than a registry artifact
— the same endpoint serves `@roo-code/types`, so the scope itself is public and
resolvable. Zoo Code v3.78.0 did touch `apps/cli/`, so the entry stays.

Re-checked 2026-09-12 and still unmet: `apps/cli/package.json` on `main` is
still `@roo-code/cli` v0.1.17 with `private: true` and no `publishConfig`, and
the npm registry and downloads API both report the package as not found. The
entry stays.

Re-checked 2026-09-16 and still unmet: `apps/cli/package.json` is still
`@roo-code/cli` v0.1.17 with `private: true`, and npm still reports the package
as not found. The entry stays.

Re-checked 2026-09-26 and still unmet: the package is still `private: true`,
npm still returns 404, and Zoo Code itself is at v3.84.0. The entry stays.

## Watchlist candidates recorded on 2026-09-12

Sources for the rows added on 2026-09-12 by the discovery pass. Remove a
candidate's bullet here when its table row is promoted or retired.

- ForgeCode: `https://github.com/tailcallhq/forgecode` (README lists
  `AGENTS.md`, `.forge/agents/*.md`, `.forge/commands/*.yaml`, `forge.yaml`,
  `.forge/skills/<name>/SKILL.md`, `.mcp.json`),
  `https://forgecode.dev/docs/agent-configuration/`.
- Agentforce Vibes: `https://developer.salesforce.com/docs/platform/einstein-for-devs/guide/devagent-rules.html`
  (403 to fetchers). `https://github.com/designthynk/agentforce` is an
  unofficial, unverified third-party write-up: it is not promotion evidence,
  and only the official docs page counts as evidence for the re-check condition.
- Verdent: `https://www.verdent.ai/docs/verdent-for-vscode/configuration/settings`.
- Baidu Comate / Zulu: `https://www.npmjs.com/package/@comate/zulu`,
  `https://docs.cloudbase.net/en/ai/cloudbase-ai-toolkit/ide-setup/baidu-comate`
  (third-party Tencent CloudBase documentation, not a Baidu primary source; no
  official English page for the `.baidu-comate/mcp.json` layout was found).
- Warp Factories: `https://docs.warp.dev/factories/factory-as-code/` (recorded
  from the `warp` re-check; the 2026-08-23 comment on #2598 said this entry had
  been added, but it never landed in this file).

## Re-check on 2026-09-16

Every row above was re-checked by the 2026-09-16 discovery pass and left as is
unless noted:

- ForgeCode: unmet — `@antinomyhq/forge` ~500 downloads/week, latest 2.13.21
  (2026-07-31), 7,633 stars; the docs site still renders client-side.
- Agentforce Vibes: unmet — the official rules docs still return 403 and no CLI
  layout is documented.
- Verdent: unmet — the settings page still lists only `AGENTS.md`,
  `~/.verdent/{VERDENT.md,plan_rules.md,subagents/}` and `~/.verdent/mcp.json`;
  no project tree or CLI.
- Baidu Comate / Zulu: unmet — ~290 downloads/week, 1.7.19 (2026-09-15), still
  no English layout docs.
- Aider: unmet — last push 2026-05-22, PyPI 0.86.2 (2026-02-12). Retirement
  candidate: retire on the next pass if the release cadence has still not
  resumed.
- iFlow CLI: unmet — last push 2026-03-20, ~220 downloads/week, 0.5.19
  (2026-04-25). Retirement candidate on the same terms as Aider.
- Warp Factories: unmet — still Early Access, definitions still live in a
  separate factory repository.
- OpenClaw: promoted (see `## Promoted entries`); the 2026-09-12 row is removed.

## Watchlist candidates recorded on 2026-09-16

Sources for the rows added on 2026-09-16 by the discovery pass. Remove a
candidate's bullet here when its table row is promoted or retired.

- fx: `https://github.com/vercel-labs/fx`,
  `https://fx.sh/docs/configure-fx/configuration`,
  `https://fx.sh/docs/configure-fx/permissions`,
  `https://fx.sh/docs/capabilities/mcp`, `https://fx.sh/docs/capabilities/skills`.
- Zencoder: `https://docs.zencoder.ai/llms-full.txt` (the rules-file layout is
  only described in course material such as
  `https://docs.zencoder.ai/learn/10x-engineer/module-03`, not on a reference
  page).
- Nanocoder: `https://github.com/Nano-Collective/nanocoder`,
  `https://github.com/Nano-Collective/nanocoder/blob/main/docs/configuration/index.md`.
- Every Code: `https://github.com/just-every/code`.

## Re-check on 2026-09-26

Every row above was re-checked by the 2026-09-26 discovery pass and left as is
unless noted:

- ForgeCode: unmet — `@antinomyhq/forge` ~550 downloads/week, still 2.13.21,
  7,639 stars; the docs site still renders client-side.
- Agentforce Vibes: unmet — the official rules docs still return 403.
- Verdent: unmet — unchanged since 2026-09-16.
- Baidu Comate / Zulu: unmet — 1.7.21, ~550 downloads/week; `zulu inspect` is
  documented only in Chinese and without file paths.
- Warp Factories: unmet — still Early Access.
- fx: unmet — 3,157 stars, v0.0.11; the project `.fx.json` now has five keys
  (adds `provider_order` / `provider_strict`) but still no rules / permissions /
  hooks.
- Zencoder: unmet — unchanged; `.zencoder/skills` is now deprecated in favor of
  `.agents/skills` (already covered).
- Nanocoder: unmet — 2,492 stars, ~1.3k downloads/week, 1.30.0.
- Every Code: unmet — 4,030 stars, ~450 downloads/week, 0.6.192.
- Aider: retired — last push still 2026-05-22 and PyPI still 0.86.2
  (2026-02-12); the release cadence has not resumed since the 2026-09-16
  retirement warning. Row and source bullet removed.
- iFlow CLI: retired — last push still 2026-03-20, still 0.5.19, ~500
  downloads/week; no sign of resumed development. Row and source bullet
  removed.

## Watchlist candidates recorded on 2026-09-26

Sources for the rows added on 2026-09-26 by the discovery pass. Remove a
candidate's bullet here when its table row is promoted or retired.

- Open Interpreter: `https://github.com/openinterpreter/openinterpreter/blob/main/docs/portability.md`,
  `https://github.com/openinterpreter/openinterpreter/blob/main/docs/hooks.md`,
  `https://www.openinterpreter.com/docs/terminal/config`.
- jcode: `https://github.com/1jehuang/jcode`.

## Promoted entries

- **MiMo Code** — OpenCode fork reading `.mimocode/` (`mimocode.jsonc`,
  commands, agents, skills) and `~/.config/mimocode/`. Proposed as #3173 on
  2026-09-26 directly from the discovery pass. Do not re-add it — track the
  proposal on that issue.
- **Codewhale** (formerly DeepSeek TUI) — `.codewhale/` tree
  (`constitution.json`, `agents/*.toml`, skills, `hooks.toml`) plus
  `~/.codewhale/`. Proposed as #3174 on 2026-09-26 directly from the discovery
  pass. Do not re-add it — track the proposal on that issue.
- **Letta Code** — `.letta/settings.json` permissions and hooks,
  `.letta/.lettaignore`, `.letta/agents/*.md`. Proposed as #3175 on 2026-09-26
  directly from the discovery pass. Do not re-add it — track the proposal on
  that issue.

- **oh-my-pi (`omp`)** — `.omp/` tree (rules, `mcp.json`, commands, agents,
  skills, `hooks/pre|post/*.ts`, `config.yml` permissions) plus `~/.omp/agent/`.
  Proposed as #3080 on 2026-09-16 directly from the discovery pass. Do not
  re-add it — track the proposal on that issue.
- **GitLab Duo CLI** — `.gitlab/duo/` tree (`chat-rules.md`, `mcp.json`,
  `hooks.json`, `plugins.json`, `mr-review-instructions.yaml`) plus
  `.agents/commands/` and root `skills/`. Proposed as #3081 on 2026-09-16
  directly from the discovery pass. Do not re-add it — track the proposal on
  that issue.
- **Codebuff** — `knowledge.md` rules, `.agents/mcp.json`, `.codebuffignore`,
  `.agents/*.ts` subagents. Proposed as #3082 on 2026-09-16 directly from the
  discovery pass. Do not re-add it — track the proposal on that issue.
- **OpenClaw** — `~/.openclaw/workspace/AGENTS.md` rules. Recorded on the
  watchlist on 2026-09-12 and proposed as #3052; the row was removed on
  2026-09-16. Do not re-add it — track the proposal on that issue.
- **IBM Bob** — `.bob/` tree (rules, `.bobignore`, `mcp.json`, commands,
  skills, `settings.json` hooks). Proposed as #3011 on 2026-09-12 directly from
  the discovery pass. Do not re-add it — track the proposal on that issue.
- **Snowflake Cortex Code** — `.cortex/` tree plus `~/.snowflake/cortex/`.
  Proposed as #3012 on 2026-09-12 directly from the discovery pass. Do not
  re-add it — track the proposal on that issue.
- **Tabnine CLI** — `TABNINE.md`, `.tabnineignore`, `.tabnine/agent/`.
  Proposed as #3013 on 2026-09-12 directly from the discovery pass and shipped
  as the `tabnine` target. Since Tabnine 6.6.0 (2026-09-15) that CLI is
  "Tabnine CLI (Legacy)" in maintenance mode until 2026-12-31, and the current
  "Tabnine CLI" is an OpenCode distribution covered by `--targets opencode`
  (tracked in #3077). Do not re-add it.
- **GitHub Copilot app (desktop)** — `.github/github-app.yml`. Condition met and
  promoted to #2671 on 2026-08-13; removed from the table on 2026-08-17. Do not
  re-add it — track the proposal on that issue instead.
