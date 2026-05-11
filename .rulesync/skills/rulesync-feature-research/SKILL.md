---
name: rulesync-feature-research
description: >-
  Maps rulesync feature implementations to upstream coding-agent documentation.
  Use when evaluating rulesync issues, comparing any coding-agent client with
  rulesync source capability surfaces, checking support, or planning a client map.
---

# Rulesync Feature Research

## What

Build a reproducible map between a coding-agent client, an upstream feature
surface, and the local rulesync implementation.

| Request target            | Read                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `antigravity`             | `references/antigravity.md`                                           |
| `augmentcode`             | `references/augmentcode.md`                                           |
| `claudecode`              | `references/claudecode.md`                                            |
| `cline`                   | `references/cline.md`                                                 |
| `codexcli`                | `references/codexcli.md`                                              |
| `copilot`                 | `references/copilot.md`                                               |
| `copilotcli`              | `references/copilotcli.md`                                            |
| `cursor`                  | `references/cursor.md`                                                |
| `deepagents`              | `references/deepagents.md`                                            |
| `factorydroid`            | `references/factorydroid.md`                                          |
| `geminicli`               | `references/geminicli.md`                                             |
| `goose`                   | `references/goose.md`                                                 |
| `junie`                   | `references/junie.md`                                                 |
| `kilo`                    | `references/kilo.md`                                                  |
| `kiro`                    | `references/kiro.md`                                                  |
| `opencode`                | `references/opencode.md`                                              |
| `pi`                      | `references/pi.md`                                                    |
| `qwencode`                | `references/qwencode.md`                                              |
| `replit`                  | `references/replit.md`                                                |
| `roo`                     | `references/roo.md`                                                   |
| `rovodev`                 | `references/rovodev.md`                                               |
| `takt`                    | `references/takt.md`                                                  |
| `warp`                    | `references/warp.md`                                                  |
| `windsurf`                | `references/windsurf.md`                                              |
| `zed`                     | `references/zed.md`                                                   |
| Any other rulesync target | `references/rulesync-source-map.md` + the closest existing client map |

A target without `references/<client>.md` is To be coming, not unsupported.

To add a client map:

1. Create `references/<client>.md` from the closest existing map.
2. Fill `Official Docs` with the client's docs URLs and feature surfaces.
3. Add `Client Anchors` only for behavior not obvious from `rulesync-source-map.md`.
4. Add the client to the request target table.

## Contract

Input:

| Field    | Source                                                                 |
| -------- | ---------------------------------------------------------------------- |
| Client   | User prompt or issue text; validate with the rulesync target list      |
| Question | Support check, diff, capability surface, issue triage, or new map work |

Reproducibility boundary: same question, official docs, local source tree, and
dry-run command/config.

Collect:

1. Canonical target and feature lists from `references/rulesync-source-map.md`.
2. Rulesync support labels from the README support table, then verify with source.
3. Official docs from the selected client map.
4. Client anchors for surfaces not obvious from naming rules.
5. Dry-run output for generator gates and output roots.

Scope:

- Inspect every rulesync feature for each requested client.
- Do not narrow the investigation by feature or surface.
- Do not explain scope normalization in the final answer.

Dry-run commands:

```bash
pnpm run dev generate --targets <client> --features "*" --dry-run
pnpm run dev generate --targets <client> --features "*" --global --dry-run
pnpm run dev generate --targets "*" --features "*" --dry-run
```

Use client all-feature dry-runs by default. Use the all-target dry-run for
cross-client questions. Dry-run is validation, not the answer.

Output:

1. Start with the result table.

| Feature | Agent surface | Rulesync support | Rulesync surface | Difference |
| ------- | ------------- | ---------------- | ---------------- | ---------- |

Use README-style support labels for Rulesync: `project`, `global`, `simulated`,
`unsupported`.

2. Add a surface table when the feature has sub-surfaces such as hook events,
   MCP transports, permission actions, config keys, metadata fields, or output roots.

| Surface | Agent surface | Rulesync map | Difference |
| ------- | ------------- | ------------ | ---------- |

3. End with capability gaps.

Use this section title:

```markdown
## Capability Gaps
```

List only material feature gaps: unsupported upstream capabilities, missing
project/global scope, missing event/config surfaces, lossy import/export, or
deprecated surfaces that should be replaced. Each bullet should name the
feature and user-visible missing capability. Write `None` only when every
observed difference is an intentional mapping or already covered behavior.

Do not list tests, fixtures, refactors, source locations, or implementation
chores unless they are necessary to explain the capability gap. Do not write
"implementation change is not needed"; it is ambiguous.

Skip separate sections for canonicalization, map status, dry-run logs, and
source lists unless the user asks for them.
