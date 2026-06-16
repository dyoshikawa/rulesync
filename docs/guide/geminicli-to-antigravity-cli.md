# Gemini CLI → Antigravity CLI Migration

Google is **retiring Gemini CLI on June 18, 2026**. On that date, Gemini CLI and
the Gemini Code Assist IDE extensions stop serving requests for Google AI
Pro/Ultra and free Gemini Code Assist for individuals. **Enterprise** plans
(Gemini Code Assist Standard/Enterprise, and GCA for GitHub via Google Cloud)
are **unaffected**.

The successor is the **Antigravity CLI** (`agy`), the Go-based CLI that shipped
with Antigravity 2.0 at Google I/O 2026. It carries over the most critical
features of Gemini CLI — Agent Skills, Hooks, MCP, and rules/context files —
though Google has stated there is **no 1:1 feature parity right out of the
gate**.

This guide explains how to move a rulesync configuration from the `geminicli`
target to the new `antigravity-cli` target.

## `geminicli` is not removed

Rulesync keeps the `geminicli` target:

- Enterprise access to Gemini CLI continues past June 18, 2026.
- Countless existing `GEMINI.md` / `.gemini/` repositories still depend on it.

`geminicli` is simply **marked deprecated** in the
[supported tools matrix](../reference/supported-tools.md). New projects should
prefer `antigravity-cli`; existing projects can keep generating both during a
transition.

## Feature mapping

| Feature     | `geminicli`                            | `antigravity-cli`                                                                           |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| rules       | root `GEMINI.md` + `.gemini/memories/` | root `AGENTS.md` + `.agents/rules/`; global `~/.gemini/GEMINI.md`                           |
| skills      | `.gemini/skills/`                      | `.agents/skills/`; global `~/.gemini/antigravity-cli/skills/`                               |
| mcp         | `.gemini/settings.json` (`mcpServers`) | `.agents/mcp_config.json`; global `~/.gemini/config/mcp_config.json` (shared config dir)    |
| hooks       | `.gemini/` (Gemini hook shape)         | `.agents/hooks.json`; global `~/.gemini/config/hooks.json` (Claude-Code-like matcher shape) |
| permissions | `.gemini/settings.json`                | global `~/.gemini/antigravity-cli/settings.json` (`permissions.allow`/`ask`/`deny`)         |
| commands    | `.gemini/commands/` (TOML)             | **not yet supported** — Antigravity CLI exposes slash commands via skills                   |
| subagents   | `.gemini/agents/`                      | **not yet supported** — CLI subagents are only definable via plugin bundles                 |

### Notable differences

- **MCP**: Antigravity uses `serverUrl` (not `url`) for HTTP servers and honors
  a `disabledTools` array. Rulesync emits the Antigravity-compatible shape
  automatically.
- **Hooks**: Antigravity uses a Claude-Code-like `hooks.json` with a matcher
  shape, **not** the Gemini CLI hook format. The event map is nested under a
  generated `rulesync` hook name (`{ "rulesync": { "<Event>": [...] } }`).
  Rulesync translates five events for Antigravity: `preToolUse`, `postToolUse`,
  `preModelInvocation` (→ `PreInvocation`), `postModelInvocation`
  (→ `PostInvocation`), and `stop`; the model-invocation events and `stop` are
  matcher-less handler lists.
- **Permissions**: The Antigravity CLI reads permissions only from the global
  `~/.gemini/antigravity-cli/settings.json`; there is no documented
  workspace-scoped permissions file, so rulesync generates this file in
  **global mode only**. The canonical `bash` tool maps to Antigravity's
  `command` tool name.
- **Commands / subagents**: These are intentionally out of scope for
  `antigravity-cli` today. Antigravity surfaces slash commands through skills.
  CLI subagents are defined and managed at runtime (the interactive `/agents`
  panel and the orchestrator's `invoke_subagent` / `define_subagent` tools), and
  the only file-based way to ship one is bundled inside a plugin (a namespaced
  package of skills + subagents + rules + MCP + hooks). There is no standalone,
  declarative per-agent file (analogous to `geminicli`'s `.gemini/agents/`) that
  rulesync could generate, and the plugin bundle does not map cleanly onto
  rulesync's per-feature model. Keep generating subagents with `geminicli` if
  you still rely on them.

## Updating `rulesync.jsonc`

Replace the `geminicli` target with `antigravity-cli`. For example:

```jsonc
{
  "targets": {
    // Before
    // "geminicli": { "rules": true, "skills": true, "mcp": true, "hooks": true, "permissions": true },

    // After
    "antigravity-cli": {
      "rules": true,
      "skills": true,
      "mcp": true,
      "hooks": true,
      "permissions": true,
    },
  },
}
```

To generate global-scope files (including the permissions file, which is
global-only), run with `--global`:

```bash
rulesync generate --targets antigravity-cli --global
```

You can keep both targets enabled during a transition so the same `.rulesync/`
sources fan out to both `.gemini/` (Gemini CLI) and `.agents/` (Antigravity
CLI) trees.

## See also

- [Supported Tools and Features](../reference/supported-tools.md)
- [Global Mode](./global-mode.md)
- Google's official migration guide: <https://antigravity.google/docs/gcli-migration>
- Announcement: <https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/>
