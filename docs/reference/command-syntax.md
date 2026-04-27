# Command Syntax

Slash commands authored under `.rulesync/commands/*.md` use a **universal syntax** that mirrors Claude Code's command placeholders. When rulesync generates a tool-specific command file, it rewrites these placeholders into the syntax that the target tool understands. The reverse rewrite happens on import, so a rulesync ↔ tool round-trip preserves the original universal form.

## Universal placeholders

| Placeholder  | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `$ARGUMENTS` | The full argument string the user supplied when invoking the command.    |
| `` !`cmd` `` | Inline shell expansion. The agent runs `cmd` and substitutes its output. |

These are written exactly as Claude Code accepts them, so writing a rulesync command body is the same as writing a Claude Code command body.

## Per-tool translation

The table below shows how each placeholder is translated for the supported tools. "pass-through" means the placeholder is emitted verbatim because the target tool already understands the universal form.

| Tool            | `$ARGUMENTS` | `` !`cmd` `` |
| --------------- | ------------ | ------------ |
| Claude Code     | pass-through | pass-through |
| Codex CLI       | pass-through | pass-through |
| Gemini CLI      | `{{args}}`   | `!{cmd}`     |
| Pi              | pass-through | pass-through |
| Other tools[^1] | pass-through | pass-through |

[^1]: Tools not listed do not have a documented translation; their command body is emitted as-is.

The translation also runs in reverse when you import an existing tool command file via `rulesync import`, so e.g. a Gemini CLI command containing `{{args}}` becomes `$ARGUMENTS` in the generated `.rulesync/commands/*.md`.

## Example

Given the following rulesync command:

```md
---
targets: ["geminicli"]
description: "Summarize git diff"
---

Summarize the diff:
!`git diff`

Focus on $ARGUMENTS.
```

rulesync generates `.gemini/commands/summarize.toml`:

```toml
description = "Summarize git diff"
prompt = """
Summarize the diff:
!{git diff}

Focus on {{args}}.
"""
```

## Notes

- If you author a command with explicit tool-specific syntax (e.g. you write `{{args}}` directly in a rulesync command body), rulesync does **not** re-translate the already-tool-native form. Stick to the universal placeholders to keep commands portable across tools.
- The shell expansion regex matches a single backtick-delimited segment without embedded backticks or newlines (`` !`...` ``). Multi-line shell snippets are not supported.
- Gemini CLI accepts both `{{args}}` and `{{ args }}` (with whitespace). rulesync canonicalizes the imported form to `$ARGUMENTS`.
