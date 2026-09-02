---
name: rulesync-mcp
description: >-
  Operate the Rulesync MCP server (`rulesync mcp`), which exposes a single
  `rulesyncTool` for managing the `.rulesync/` sources — rules, commands,
  subagents, skills, checks, ignore, MCP, permissions, hooks — and for running
  generate, import, and convert. Use when setting up the Rulesync MCP server,
  or when reading or writing Rulesync configuration through MCP instead of the
  CLI.
targets: ["*"]
---

# Rulesync MCP Server

`rulesync mcp` starts an MCP server over stdio that exposes exactly one tool,
`rulesyncTool`, so the tool definition costs well under 1k tokens.

Its per-item operations — `list`, `get`, `put`, `delete` — read and write the
`.rulesync/` source tree only. They never touch the generated tool files
(`CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, …), so such a
write stays invisible to every AI coding tool until you regenerate; see
[Always regenerate after writing](#always-regenerate-after-writing).

`generate`, `import`, and `convert` are the operations that do cross that line:
`generate` and `convert` write the tool files, and `import` reads them back into
`.rulesync/`.

## Setup

Register the server with the tool that will call it. Let Rulesync manage its own
MCP configuration by declaring it in `.rulesync/mcp.jsonc`:

```jsonc
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json",
  "mcpServers": {
    "rulesync-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rulesync", "mcp"],
      "env": {},
    },
  },
}
```

Then write it out to each tool's own MCP config file:

```bash
rulesync generate --targets "*" --features mcp
```

The server resolves `.rulesync/` from the working directory it was started in,
so launch it at the repository root.

## Calling `rulesyncTool`

Every call passes a `feature` and an `operation`, plus the arguments that pair
needs. Unsupported pairs are rejected.

| `feature`                                       | Supported `operation`s         | Target            |
| ----------------------------------------------- | ------------------------------ | ----------------- |
| `rule`, `command`, `subagent`, `skill`, `check` | `list`, `get`, `put`, `delete` | One item per call |
| `ignore`, `mcp`, `permissions`, `hooks`         | `get`, `put`, `delete`         | One fixed file    |
| `generate`, `import`, `convert`                 | `run`                          | The whole project |

### Arguments by operation

- `list` — no other argument. Returns every item of that feature **that parses**:
  an item whose file cannot be read or whose frontmatter is invalid is dropped
  silently, because these four operations report no `warnings` and the server's
  log never reaches the calling agent. A `list` that comes back shorter than the
  directory means a broken item, not an empty directory.
- `get` / `delete` — `targetPathFromCwd`.
- `put` — `targetPathFromCwd`, plus `frontmatter` (object) and `body` (string).
- `run` — `generateOptions`, `importOptions`, or `convertOptions` (below).

`ignore`, `mcp`, `permissions`, and `hooks` are the exception: their path is
fixed, so they take no `targetPathFromCwd` on any operation, and their `put`
takes `content` — the whole file as a string — instead of `frontmatter` and
`body`. `ignore` covers two files: its `delete` removes both
`.rulesync/.aiignore` and the legacy `.rulesyncignore`.

`targetPathFromCwd` is relative to the working directory, and it is the item's
own path in `.rulesync/`: a file path such as `.rulesync/rules/overview.md` for
`rule`, `command`, `subagent`, and `check`, but the skill **directory** path
(`.rulesync/skills/my-skill`) for `skill`.

`put` is an upsert: it creates the item when it is missing and overwrites it
otherwise. To edit one, `get` it first and send the full merged result back —
there is no partial update, so a `put` that omits a field drops it.

Size limits: 1MB per rule, command, subagent, and check file, 1MB for `mcp`,
`permissions`, and `hooks`, and 100KB for `ignore`. A skill's 1MB budget covers
the whole directory — frontmatter, body, and every `otherFiles` entry together.
Rules, commands, subagents, skills, and checks are each capped at 1000 items.

### `skill` and its `otherFiles`

A skill directory holds `SKILL.md` (its `frontmatter` and `body`) plus any other
files, passed as `otherFiles`: `{ name, body, encoding }`, where `name` is the
path relative to the skill directory (e.g. `references/api.md`) and `encoding`
is `"utf-8"` (default) or `"base64"` for binary files.

`get` labels every returned entry with the encoding it needs. **Keep that
`encoding` field when feeding entries back into `put`** — dropping it stores a
base64 body as literal text and corrupts the file.

`put` overlays the directory rather than replacing it: it rewrites `SKILL.md`
and every `otherFiles` entry you send, and leaves every other file already in
the directory untouched. It therefore cannot remove a file — to drop one,
`delete` the skill and `put` it back without that entry.

### Running `generate`, `import`, and `convert`

```jsonc
// feature: "generate", operation: "run"
"generateOptions": {
  "targets": ["claudecode", "cursor"],  // default: from rulesync.jsonc
  "features": ["rules", "mcp"],         // default: from rulesync.jsonc
  "delete": false,                      // true deletes generated files that lost their source
  "global": false,                      // true writes user-scope configs outside the repository
  "simulateCommands": false,            // these three default to false
  "simulateSubagents": false,
  "simulateSkills": false
}

// feature: "import", operation: "run" — exactly one source tool
"importOptions": { "target": "claudecode", "features": ["rules", "mcp"], "global": false }

// feature: "convert", operation: "run" — "to" must not contain "from"
"convertOptions": { "from": "cursor", "to": ["copilot", "claudecode"], "features": ["rules"], "dryRun": false }
```

MCP arguments win over `rulesync.local.jsonc`, which wins over `rulesync.jsonc`,
which wins over the defaults.

A `generate` run that writes nothing succeeded — generation is idempotent and
only rewrites files whose content changed. Read the returned `message` rather
than treating a zero count as a failure.

These three operations are also the only ones that report `warnings`: an array
of strings, present on success and on failure alike whenever the run had
something worth acting on — for example that a machine-local overrides file was
read into files you commit. Read it; it is the only channel the server has, as
its console output never reaches the calling agent.

## Always regenerate after writing

`put` and `delete` touch `.rulesync/` alone. Finish any editing session with a
`generate` run (or `rulesync generate` on the CLI) so the tool-specific files
match the sources, and commit both together.

## Detailed reference

The full documentation ships with the CLI:

```bash
rulesync docs reference/mcp-server   # this server, in full
rulesync docs reference/cli-commands # generate / import / convert options
rulesync docs --search "mcp"
```
