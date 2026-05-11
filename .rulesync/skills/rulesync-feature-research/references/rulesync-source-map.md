# Rulesync Source Map

Entry points for lists, processors, capability surfaces, tests, and generated
output paths.

## Source

| Need                   | Path or symbol                                     |
| ---------------------- | -------------------------------------------------- |
| Targets                | `ALL_TOOL_TARGETS` in `src/types/tool-targets.ts`  |
| Features               | `ALL_FEATURES` in `src/types/features.ts`          |
| Generate orchestration | `src/lib/generate.ts`                              |
| CLI generate command   | `src/cli/commands/generate.ts`, `src/cli/index.ts` |
| Rulesync paths         | `src/constants/rulesync-paths.ts`                  |
| Support labels         | `README.md`, `docs/reference/supported-tools.md`   |
| Feature processors     | `src/features/<feature>/*-processor.ts`            |
| End-to-end tests       | `src/e2e/**/*`                                     |

## Dry-Run

```bash
pnpm run dev generate --targets <client> --features <feature> --dry-run
pnpm run dev generate --targets "*" --features "*" --dry-run
pnpm run dev generate --targets <client> --features <feature> --global --dry-run
pnpm run dev generate --targets <client> --features commands,subagents,skills --simulate-commands --simulate-subagents --simulate-skills --dry-run
```

Interpretation:

- `Target '<client>' does not support...` comes from processor support gates.
- `Would write` and `Would create directory` show current output paths.
- `Would delete` is orphan cleanup, not a support claim.
- Zero output can mean zero input files. It is not proof of no support.
- Project, global, and simulated modes can differ.
- Dry-run is evidence, not the output format.

If dry-run and adapter-file existence disagree, inspect the processor factory
map and `getToolTargets`.

## Feature Map

| Feature       | Gate                       | Adapter                               | Canonical source                                              | Inspect for parity                                                                                                                     |
| ------------- | -------------------------- | ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `rules-processor.ts`       | `rules/<client>-rule.ts`              | `rules/rulesync-rule.ts`                                      | Frontmatter schemas, `getSettablePaths`, conversions, discovery mode, imports, local root, conventions, deletion                       |
| `mcp`         | `mcp-processor.ts`         | `mcp/<client>-mcp.ts`                 | `mcp/rulesync-mcp.ts`, `types/mcp.ts`                         | `McpServerSchema`, `RulesyncMcpServerSchema`, `stripMcpServerFields`, transports, env/header/auth fields, tool filters, merge behavior |
| `commands`    | `commands-processor.ts`    | `commands/<client>-command.ts`        | `commands/rulesync-command.ts`                                | Frontmatter schemas, arguments, model/tools, extension, subdirectories, project/global/simulated modes, collisions                     |
| `subagents`   | `subagents-processor.ts`   | `subagents/<client>-subagent.ts`      | `subagents/rulesync-subagent.ts`                              | Frontmatter or TOML schemas, required fields, model/tools/sandbox/body movement, project/global/simulated modes                        |
| `skills`      | `skills-processor.ts`      | `skills/<client>-skill.ts`            | `skills/rulesync-skill.ts`                                    | `SKILL.md` metadata, output roots, target filters, supporting files, scheduled tasks, `tool-skill.ts`                                  |
| `hooks`       | `hooks-processor.ts`       | `hooks/<client>-hooks.ts`             | `hooks/rulesync-hooks.ts`, `types/hooks.ts`                   | `HookEvent`, client event arrays, event-name maps, matcher support, hook types, config paths, auxiliary files, import support          |
| `permissions` | `permissions-processor.ts` | `permissions/<client>-permissions.ts` | `permissions/rulesync-permissions.ts`, `types/permissions.ts` | Action schemas, rule schemas, tool-name maps, approval/sandbox mapping, config/profile paths, merge logic                              |
| `ignore`      | `ignore-processor.ts`      | `ignore/<client>-ignore.ts`           | `ignore/rulesync-ignore.ts`                                   | `tool-ignore.ts`, ignore syntax, generated entries, local/shared options, target output file                                           |

## Tests

| Need            | Pattern                                |
| --------------- | -------------------------------------- |
| Adapter tests   | `src/features/**/<client>-*.test.ts`   |
| Processor tests | `src/features/**/**processor*.test.ts` |
| E2E tests       | `src/e2e/**/*`                         |

When tests are missing, verify behavior through the processor that imports the
adapter before adding focused coverage.

## Generated Output

Use dry-run for output roots. Skills can land under `.agent/skills`,
`.agents/skills`, `.claude/skills`, `.codex/skills`, or another client root
depending on the adapter and mode.
