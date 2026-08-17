# New-Target Watchlist

Products that are not Rulesync targets today but could become one. They are
recorded here rather than left in a research issue so a later
`research-tool-updates` run re-checks them instead of re-deriving them.

Each entry states the condition to re-check. When a condition is met, promote
the entry to a target proposal (a GitHub issue) and remove it from this file;
when the product is discontinued or the condition can no longer be met, retire
the entry the same way. An entry that is neither promoted nor retired stays.

| Candidate                      | Recorded   | Re-check condition                                                                            |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| Zoo Code CLI (`@roo-code/cli`) | 2026-08-08 | Whether the package ships publicly; today it is `private: true`, unpublished and undocumented |

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

## Promoted entries

- **GitHub Copilot app (desktop)** — `.github/github-app.yml`. Condition met and
  promoted to #2671 on 2026-08-13; removed from the table on 2026-08-17. Do not
  re-add it — track the proposal on that issue instead.
