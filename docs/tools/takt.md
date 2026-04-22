# Takt

[Takt](https://github.com/dyoshikawa/takt) is a faceted-prompting AI coding workflow tool. Rulesync generates plain-Markdown facet files into Takt's `.takt/facets/` layout (or `~/.takt/facets/` in global mode).

## Output mapping

| Rulesync feature | Default facet directory      | Allowed `takt.facet` overrides                          |
| ---------------- | ---------------------------- | ------------------------------------------------------- |
| `subagents`      | `.takt/facets/personas/`     | `persona` only (override is a no-op)                    |
| `rules`          | `.takt/facets/policies/`     | `policy` (default), `knowledge`, `output-contract`      |
| `commands`       | `.takt/facets/instructions/` | `instruction` only (override is a no-op)                |
| `skills`         | `.takt/facets/instructions/` | `instruction` (default), `knowledge`, `output-contract` |

The facet override is read from the rulesync source frontmatter under the `takt:` key:

```yaml
---
takt:
  facet: knowledge # rules + skills only
  name: my-renamed-stem
---
```

- `takt.facet` is **optional**; the per-feature default is used when absent.
- A disallowed value (for example `takt.facet: persona` on a rule) raises a hard validation error at `generate` time.
- `takt.name` is also optional and lets you rename the emitted filename stem to escape collisions.

Output files are **plain Markdown** — the source frontmatter is dropped entirely and the body is written verbatim. The filename stem of the source is preserved unless `takt.name` is set:

```
.rulesync/subagents/coder.md  →  .takt/facets/personas/coder.md
.rulesync/rules/style.md      →  .takt/facets/policies/style.md
.rulesync/commands/review.md  →  .takt/facets/instructions/review.md
.rulesync/skills/oncall/SKILL.md → .takt/facets/instructions/oncall.md
```

## Scope

Both project mode (`.takt/facets/...`) and global mode (`~/.takt/facets/...`) are supported.

## Filename collisions

Because commands and skills can both write to `.takt/facets/instructions/`, two source files that share a stem may collide. When this happens, Rulesync logs a warning naming both source files plus the conflicting target path and SKIPS writing both colliding files for that target — the rest of the run continues. Other (non-colliding) takt files are still written, and other targets are unaffected. Rename one of the colliding sources via `takt.name` to disambiguate.

## Importing existing TAKT files into rulesync

Reverse import (`rulesync import --targets takt`) is **not supported**. TAKT facet files are plain Markdown with no frontmatter, so the original skill / command / subagent metadata cannot be recovered. Attempting to import a TAKT skill raises a clear error rather than silently producing a stub that round-trips badly.
