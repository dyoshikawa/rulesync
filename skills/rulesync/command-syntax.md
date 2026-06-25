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

| Tool              | `$ARGUMENTS`           | `` !`cmd` ``                |
| ----------------- | ---------------------- | --------------------------- |
| Claude Code       | pass-through           | pass-through                |
| Codex CLI[^codex] | pass-through (literal) | pass-through (literal)      |
| Pi                | pass-through           | pass-through (literal)[^pi] |
| Other tools[^1]   | pass-through (literal) | pass-through (literal)      |

[^1]: Tools not listed do not have a documented translation; their command body is emitted as-is.

[^codex]: Codex CLI prompt files are forwarded to the LLM verbatim; the placeholders are passed to the model as literal text rather than being substituted by the engine.

[^pi]: Pi natively expands `$ARGUMENTS` (along with `$1`, `$2`, `$@`), so `$ARGUMENTS` is a real pass-through there. rulesync still emits `` !`cmd` `` verbatim for Pi, but does not assume Pi expands inline shell snippets — treat that placeholder as literal text on Pi's side.

The translation also runs in reverse when you import an existing tool command file via `rulesync import`, so a tool-native placeholder is rewritten back to the universal form in the generated `.rulesync/commands/*.md`.

## Example

Given the following rulesync command:

```md
---
targets: ["claudecode"]
description: "Summarize git diff"
---

Summarize the diff:
!`git diff`

Focus on $ARGUMENTS.
```

rulesync generates `.claude/commands/summarize.md`, passing the placeholders through verbatim because Claude Code already understands the universal form.

## Notes

- If you author a command with explicit tool-specific syntax (e.g. you write a tool-native placeholder directly in a rulesync command body), rulesync does **not** re-translate the already-tool-native form. Stick to the universal placeholders to keep commands portable across tools.
- The translation is purely textual and is applied to the entire body. It does not skip fenced or inline code blocks, so ` ```js\n$ARGUMENTS\n``` ` in a rulesync body will still be rewritten when generating tool output. There is **no escape syntax** for the universal placeholders — backslashes are not consumed by the regex, so `\$ARGUMENTS` is rewritten alongside the placeholder rather than producing a literal `$ARGUMENTS`.
- The shell expansion regex matches a single backtick-delimited segment without embedded backticks or newlines (`` !`...` ``). Multi-line shell snippets are not supported, and a backtick inside the command body is not allowed.
