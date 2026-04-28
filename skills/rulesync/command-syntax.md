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
| Gemini CLI        | `{{args}}`             | `!{cmd}`                    |
| Pi                | pass-through           | pass-through (literal)[^pi] |
| Other tools[^1]   | pass-through (literal) | pass-through (literal)      |

[^1]: Tools not listed do not have a documented translation; their command body is emitted as-is.

[^codex]: Codex CLI prompt files are forwarded to the LLM verbatim; the placeholders are passed to the model as literal text rather than being substituted by the engine.

[^pi]: Pi natively expands `$ARGUMENTS` (along with `$1`, `$2`, `$@`), so `$ARGUMENTS` is a real pass-through there. rulesync still emits `` !`cmd` `` verbatim for Pi, but does not assume Pi expands inline shell snippets — treat that placeholder as literal text on Pi's side.

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
- The translation is purely textual and is applied to the entire body. It does not skip fenced or inline code blocks, so ` ```js\n$ARGUMENTS\n``` ` in a rulesync body will still be rewritten when generating Gemini CLI output. There is **no escape syntax** for the universal placeholders — backslashes are not consumed by the regex, so `\$ARGUMENTS` becomes `\{{args}}`, not a literal `$ARGUMENTS`. If you need a literal `$ARGUMENTS` or `` !`cmd` `` in the emitted Gemini CLI prompt, your options are:
  1. Hand-author the Gemini-native body via the per-tool `geminicli.prompt` override (see below) — this skips translation entirely for Gemini CLI.
  2. Drop `geminicli` from the command's `targets:` so no Gemini CLI file is generated.
  3. Construct the placeholder so the regex does not match — for example, break `$ARGUMENTS` across two adjacent inline-code spans (`` `$` ``+`` `ARGUMENTS` ``) so the literal `$ARGUMENTS` substring is not present in the source body.

- The shell expansion regex matches a single backtick-delimited segment without embedded backticks or newlines (`` !`...` ``). Multi-line shell snippets are not supported, and a backtick inside the command body is not allowed — for that case, hand-author the Gemini-native form via `geminicli.prompt`.
- Gemini CLI accepts both `{{args}}` and `{{ args }}` (with whitespace). rulesync canonicalizes the imported form to `$ARGUMENTS`.
- The reverse rewrite (Gemini CLI → rulesync, on import) is **not** symmetric with the forward direction: a rulesync body that already contains Gemini-native forms (`{{args}}`, `!{cmd}`) is preserved on export, but a Gemini CLI file containing those forms is always rewritten back to the universal syntax on import. In practice this is what users want, but it does mean that an import will canonicalize away any literal `{{args}}` / `!{cmd}` text that you intended as documentation.

### Per-tool override (Gemini CLI)

If you need to bypass the translation entirely — for example, to embed a literal backtick inside a Gemini-native shell expansion — you can author the prompt directly in the `geminicli` section of the rulesync frontmatter:

```md
---
targets: ["geminicli"]
description: "Hand-authored prompt"
geminicli:
  prompt: "Run !{echo `hello`}."
---

Body content here is ignored only for the Gemini CLI output when geminicli.prompt is set.
```

When `geminicli.prompt` is present, rulesync uses it verbatim as the Gemini CLI command body and skips the universal-syntax translation entirely. Note that this override is **scoped to the Gemini CLI output only**: if `targets:` lists other tools (e.g. `["geminicli", "claudecode"]`), the rulesync command body is still used as the source for those other tools — `geminicli.prompt` does not replace the body for them.
