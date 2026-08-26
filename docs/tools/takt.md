# Takt

[Takt](https://github.com/nrslib/takt) is a faceted-prompting AI coding workflow tool. Rulesync generates plain-Markdown facet files into Takt's `.takt/facets/` layout (or `~/.takt/facets/` in global mode).

## Output mapping

Each rulesync feature maps onto a dedicated Takt facet directory. The target directory is fixed per feature, except that **rules** may opt into Takt's fifth facet — `output-contracts` — via the `takt.facet` override (see below).

| Rulesync feature | Takt facet directory                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `rules`          | `.takt/facets/policies/` (default) or `.takt/facets/output-contracts/` via `takt.facet` |
| `commands`       | `.takt/facets/instructions/`                                                            |
| `subagents`      | `.takt/facets/personas/`                                                                |
| `skills`         | `.takt/facets/knowledge/`                                                               |

Takt-specific frontmatter knobs:

```yaml
---
takt:
  name: my-renamed-stem # rename the emitted filename stem
  extends: base # emit a leading {extends:base} facet-inheritance directive
  facet: output-contracts # "policies" (default) or "output-contracts"
---
```

- `takt.name` is **optional**; the source filename stem is used by default. Unsafe values (path separators, `..` segments, etc.) raise a hard validation error at `generate` time.
- `takt.facet` is **optional** and defaults to `policies`. Setting it to `output-contracts` redirects the rule to Takt's output-structure / report-template facet, which has no dedicated rulesync feature. Both `policies` and `output-contracts` support `{extends:...}` inheritance. The other facets (`instructions`, `personas`, `knowledge`) are owned by the commands, subagents, and skills features and are not selectable via `takt.facet`.
- Like `takt.name` and `takt.extends`, `takt.facet` is a generate-side authoring control. Because Takt facet files are plain Markdown with no frontmatter, the facet selection cannot be recovered on import (see [Importing](#importing-existing-takt-files-into-rulesync) below).

Output files are **plain Markdown** — the source frontmatter is dropped entirely and the body is written verbatim:

```
.rulesync/rules/style.md         →  .takt/facets/policies/style.md
.rulesync/rules/review-format.md →  .takt/facets/output-contracts/review-format.md  (with takt.facet: output-contracts)
.rulesync/commands/review.md     →  .takt/facets/instructions/review.md
.rulesync/subagents/coder.md     →  .takt/facets/personas/coder.md
.rulesync/skills/oncall/SKILL.md →  .takt/facets/knowledge/oncall.md
```

## MCP (partial — transport allowlist only)

Takt has no project- or global-level registry of MCP server _definitions_: the concrete `mcp_servers` map (`command`/`args`/`env` or `type`/`url`/`headers`) is declared **per workflow step** inside individual workflow YAML files, and Takt's `config.yaml` loader rejects unknown top-level keys. The one MCP knob `config.yaml` does expose is the **default-deny transport allowlist** `workflow_mcp_servers: { stdio, sse, http }`; until a transport is enabled there, every workflow-defined MCP server using it is refused.

Rulesync therefore emits **only** this allowlist into the shared `.takt/config.yaml` (project) / `~/.takt/config.yaml` (global), turning on exactly the transports the servers in `.rulesync/mcp.jsonc` use (`local`/`stdio` → `stdio`, `sse` → `sse`, `http`/`streamable-http`/`ws` → `http`). The merge is in place, so the active provider, provider profiles, and all other config keys are preserved; the file is never deleted.

**Lossiness:** the per-server names, commands, env, URLs, and headers are not representable in `config.yaml` and are intentionally not written — you still declare the concrete servers in your workflow YAML steps; Rulesync only opens the transport gate that permits them. Because of this, reverse import cannot reconstruct server definitions and yields an empty `mcpServers` map.

## Checks — quality gates

`.rulesync/checks/*.md` become TAKT **quality gates** in the `workflow_overrides` block of the shared `config.yaml`. A check's body is a string gate — a completion directive TAKT injects into the agent step prompt — unless the check's `takt` frontmatter block names a `command`, which makes it a command gate TAKT runs after the step, failing the gate on a non-zero exit.

**A command gate runs unconditionally.** TAKT's default-deny `workflow_command_gates.custom_scripts` policy applies to gates declared in workflow YAML, not to gates coming from `workflow_overrides`, so a `takt.command` in a check is executed after every step it applies to with no further gating. Read the frontmatter of any check you obtain with `rulesync fetch` before generating.

**Lossiness:** TAKT gates carry no severity or tool allowlist, so a check's `severity` and `tools` fields are not written and do not come back on import.

`quality_gates_edit_only` in a check's `takt` block applies to the whole block, and reaches only the gates with no `steps` / `personas` scope — TAKT runs a scoped gate whether or not the step may edit files.

The block is owned by the checks feature: it is rewritten from `.rulesync/checks/` on every generate, and retracted when checks remain but none target TAKT. Emptying `.rulesync/checks/` altogether leaves the gates in place — the feature has no source to generate from — so delete them by hand in that case. See [file formats](../reference/file-formats.md) for the frontmatter reference.

## Scope

Both project mode (`.takt/facets/...`, `.takt/config.yaml`) and global mode (`~/.takt/facets/...`, `~/.takt/config.yaml`) are supported.

## `--delete` and `.takt/facets/knowledge/`

Skills are written as flat files sharing one facet root instead of each getting a
directory of its own, so `generate --delete` has no per-skill directory to sweep
and leaves `.takt/facets/knowledge/` alone entirely. That is deliberate: the root
also holds whatever you have authored there by hand, and sweeping it would take
those files too.

The trade-off is that a knowledge file whose `.rulesync/skills/` source you later
delete or rename is not cleaned up for you — delete the stale `.md` file
yourself.

## Importing existing TAKT files into rulesync

Importing the **facet** features (rules, commands, subagents, skills) is **not supported**. TAKT facet files are plain Markdown with no frontmatter, so the original skill / command / subagent metadata cannot be recovered. Attempting to import a TAKT skill raises a clear error rather than silently producing a stub that round-trips badly.

The `config.yaml` features do import: `rulesync import --targets takt --features checks` reads the quality gates back into `.rulesync/checks/`, and `--features permissions` reads the permission mode and the Takt-specific override keys. MCP is the exception noted above — the allowlist carries no server definitions to reconstruct.
