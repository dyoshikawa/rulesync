# New-Target Watchlist

Products that are not Rulesync targets today but could become one. They are
recorded here rather than left in a research issue so a later
`research-tool-updates` run re-checks them instead of re-deriving them.

Each entry states the condition to re-check. When a condition is met, promote
the entry to a target proposal (a GitHub issue) and remove it from this file;
when the product is discontinued or the condition can no longer be met, retire
the entry the same way. An entry that is neither promoted nor retired stays.

| Candidate                      | Recorded   | Re-check condition                                                                                                                    |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Copilot app (desktop)   | 2026-08-08 | Whether Rulesync should emit `.github/github-app.yml` — a third Copilot product, distinct from the `copilot` and `copilotcli` targets |
| Zoo Code CLI (`@roo-code/cli`) | 2026-08-08 | Whether the package ships publicly; today it is `private: true`, unpublished and undocumented                                         |

## GitHub Copilot app (desktop) — `.github/github-app.yml`

A repo-committed config file documented on 2026-08-05:
`https://docs.github.com/en/copilot/reference/github-copilot-app-reference/repository-configuration`.
It carries an `instructions:` block plus `scripts`, `server_ready_pattern`,
`auto_open_in_browser` and `automation`.

The `instructions:` block overlaps what Rulesync already generates for other
targets, so the open question is a new-target one — which product owns the file
— not a capability gap on `copilot` or `copilotcli`. Neither of those targets
reads or writes this file.

## Zoo Code CLI — `apps/cli` in the Zoo-Code repo

`https://github.com/Zoo-Code-Org/Zoo-Code` carries an `apps/cli` package
(`@roo-code/cli` v0.1.17, bin `roo`) that is `private: true`, unpublished, still
Roo-branded, and undocumented. It runs the same agent core against the same
`.roo/` assets the existing `roo` target already covers, so it is worth a new
target only if it ships publicly **and** introduces a CLI-only config surface.
Check the package's `private` flag and npm publication first; if it is public,
diff its config discovery against `references/roo.md`.
