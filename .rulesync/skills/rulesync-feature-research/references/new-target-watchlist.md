# New-Target Watchlist

Products that are not Rulesync targets today but could become one. They are
recorded here rather than left in a research issue so a later
`research-tool-updates` run re-checks them instead of re-deriving them.

Each entry states the condition to re-check. When a condition is met, promote
the entry to a target proposal (a GitHub issue) and remove it from this file;
when the product is discontinued or the condition can no longer be met, retire
the entry the same way. An entry that is neither promoted nor retired stays.

| Candidate                                         | Recorded   | Re-check condition                                                                                                                                                                                    |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoo Code CLI (`@roo-code/cli`)                    | 2026-08-08 | Whether the package ships publicly; today it is `private: true`, unpublished and undocumented                                                                                                         |
| ForgeCode (`tailcallhq/forgecode`)                | 2026-09-12 | Weekly npm downloads of `@antinomyhq/forge` reach ~2k or stars reach 10k, or an official docs page pins the `.forge/commands` YAML and `forge.yaml` schema (the docs site renders client-side today)  |
| OpenClaw (`openclaw/openclaw`)                    | 2026-09-12 | It starts reading repo-level `AGENTS.md` / `.openclaw/` from the cwd or adds command-type hooks; today it is a global-only assistant gateway whose project surface is just `.agents/skills` (covered) |
| Salesforce Agentforce Vibes (IDE + announced CLI) | 2026-09-12 | The official rules docs become reachable (403 to fetchers today) and the CLI ships a repo-level MCP / rules layout beyond `.a4drules/*.md`                                                            |
| Verdent (VS Code extension + Verdent Deck)        | 2026-09-12 | A project-scope `.verdent/` tree or a CLI with documented config appears; today only `~/.verdent/{VERDENT.md,plan_rules.md,subagents/*.md}` plus `AGENTS.md` (covered)                                |
| Baidu Comate / Zulu CLI (`@comate/zulu`)          | 2026-09-12 | English docs list the project-level file layout; today only `.baidu-comate/mcp.json` (IDE) is documented and the package is license-gated with ~290 downloads/week                                    |
| Aider (`Aider-AI/aider`)                          | 2026-09-12 | Release cadence resumes (last push 2026-05-22) and native MCP or `AGENTS.md` support lands; today the surface is `.aider.conf.yml`, `.aiderignore`, `.aider.model.settings.yml` only                  |
| iFlow CLI (`iflow-ai/iflow-cli`)                  | 2026-09-12 | Commits resume (last push 2026-03-20) and `@iflow-ai/iflow-cli` downloads grow beyond ~220/week; surface is `IFLOW.md` + `~/.iflow/settings.json`                                                     |

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

## Watchlist candidates recorded on 2026-09-12

Sources for the rows added on 2026-09-12 by the discovery pass:

- ForgeCode: `https://github.com/tailcallhq/forgecode` (README lists
  `AGENTS.md`, `.forge/agents/*.md`, `.forge/commands/*.yaml`, `forge.yaml`,
  `.forge/skills/<name>/SKILL.md`, `.mcp.json`), `https://forgecode.dev/docs/agent-configuration/`.
- OpenClaw: `https://docs.openclaw.ai/concepts/agent-workspace`,
  `https://docs.openclaw.ai/tools/skills`, `https://docs.openclaw.ai/plugins/bundles`.
- Agentforce Vibes: `https://developer.salesforce.com/docs/platform/einstein-for-devs/guide/devagent-rules.html`
  (403 to fetchers), community mirror `https://github.com/designthynk/agentforce`.
- Verdent: `https://www.verdent.ai/docs/verdent-for-vscode/configuration/settings`.
- Baidu Comate / Zulu: `https://www.npmjs.com/package/@comate/zulu`,
  `https://docs.cloudbase.net/en/ai/cloudbase-ai-toolkit/ide-setup/baidu-comate`.
- Aider: `https://github.com/Aider-AI/aider`.
- iFlow CLI: `https://github.com/iflow-ai/iflow-cli`.

## Promoted entries

- **IBM Bob** — `.bob/` tree (rules, `.bobignore`, `mcp.json`, commands,
  skills, `settings.json` hooks). Proposed as #3011 on 2026-09-12 directly from
  the discovery pass. Do not re-add it — track the proposal on that issue.
- **Snowflake Cortex Code** — `.cortex/` tree plus `~/.snowflake/cortex/`.
  Proposed as #3012 on 2026-09-12 directly from the discovery pass. Do not
  re-add it — track the proposal on that issue.
- **Tabnine CLI** — `TABNINE.md`, `.tabnineignore`, `.tabnine/agent/`.
  Proposed as #3013 on 2026-09-12 directly from the discovery pass. Do not
  re-add it — track the proposal on that issue.
- **GitHub Copilot app (desktop)** — `.github/github-app.yml`. Condition met and
  promoted to #2671 on 2026-08-13; removed from the table on 2026-08-17. Do not
  re-add it — track the proposal on that issue instead.
