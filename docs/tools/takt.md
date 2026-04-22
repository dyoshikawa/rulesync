# Takt

[Takt](https://github.com/dyoshikawa/takt) is a faceted-prompting AI coding workflow tool. Rulesync generates plain-Markdown facet files into Takt's `.takt/facets/` layout (or `~/.takt/facets/` in global mode).

## Output mapping

Each rulesync feature maps one-to-one onto a dedicated Takt facet directory. There is **no `takt.facet` override** — the target directory is fixed per feature.

| Rulesync feature | Takt facet directory         |
| ---------------- | ---------------------------- |
| `rules`          | `.takt/facets/policies/`     |
| `commands`       | `.takt/facets/instructions/` |
| `subagents`      | `.takt/facets/personas/`     |
| `skills`         | `.takt/facets/knowledge/`    |

The only Takt-specific frontmatter knob is `takt.name`, which renames the emitted filename stem:

```yaml
---
takt:
  name: my-renamed-stem
---
```

- `takt.name` is **optional**; the source filename stem is used by default.
- Unsafe values (path separators, `..` segments, etc.) raise a hard validation error at `generate` time.

Output files are **plain Markdown** — the source frontmatter is dropped entirely and the body is written verbatim:

```
.rulesync/rules/style.md        →  .takt/facets/policies/style.md
.rulesync/commands/review.md    →  .takt/facets/instructions/review.md
.rulesync/subagents/coder.md    →  .takt/facets/personas/coder.md
.rulesync/skills/oncall/SKILL.md → .takt/facets/knowledge/oncall.md
```

## Scope

Both project mode (`.takt/facets/...`) and global mode (`~/.takt/facets/...`) are supported.

## Importing existing TAKT files into rulesync

Reverse import (`rulesync import --targets takt`) is **not supported**. TAKT facet files are plain Markdown with no frontmatter, so the original skill / command / subagent metadata cannot be recovered. Attempting to import a TAKT skill raises a clear error rather than silently producing a stub that round-trips badly.
