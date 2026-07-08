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

Rulesync therefore emits **only** this allowlist into the shared `.takt/config.yaml` (project) / `~/.takt/config.yaml` (global), turning on exactly the transports the servers in `.rulesync/mcp.json` use (`local`/`stdio` → `stdio`, `sse` → `sse`, `http`/`streamable-http`/`ws` → `http`). The merge is in place, so the active provider, provider profiles, and all other config keys are preserved; the file is never deleted.

**Lossiness:** the per-server names, commands, env, URLs, and headers are not representable in `config.yaml` and are intentionally not written — you still declare the concrete servers in your workflow YAML steps; Rulesync only opens the transport gate that permits them. Because of this, reverse import cannot reconstruct server definitions and yields an empty `mcpServers` map.

## Scope

Both project mode (`.takt/facets/...`, `.takt/config.yaml`) and global mode (`~/.takt/facets/...`, `~/.takt/config.yaml`) are supported.

## Importing existing TAKT files into rulesync

Reverse import (`rulesync import --targets takt`) is **not supported**. TAKT facet files are plain Markdown with no frontmatter, so the original skill / command / subagent metadata cannot be recovered. Attempting to import a TAKT skill raises a clear error rather than silently producing a stub that round-trips badly.
