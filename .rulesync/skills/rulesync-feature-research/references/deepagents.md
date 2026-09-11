# Deep Agents CLI Map

`dcode` keeps its user profile under one root, and **`DEEPAGENTS_HOME` moves
it**: `_paths.py` captures the variable once at import time, before any dotenv
loader runs, re-exports it to every child process, and falls back to
`DEFAULT_PROFILE_DIR_NAME = ".deepagents"` under the home directory only when it
is unset. When it is set, the whole `ProfilePaths` record moves — `config_file`,
`dotenv_file`, `mcp_config_file`, `hooks_file`, `plugins_dir`, `state_dir` and
`agent_profiles_dir`. Rulesync follows it through `resolveToolOutputRoot`
(`tool-output-root.ts`) and `getDeepagentsRelativeDirPath` (`deepagents.ts`):
in global scope the override becomes the output root and the `.deepagents`
segment is stripped from every path constant, so the global paths below are the
default-profile spelling and each lands under `$DEEPAGENTS_HOME` verbatim minus
that prefix. Only the two spellings upstream accepts (absolute, or `~/`-prefixed)
are honored; other values throw. `[agents].default`, which makes the `agent`
segment of `~/.deepagents/agent/` configurable, is still not followed (#2956).

## Official Docs

| Feature       | Official docs                                                      | Upstream surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.langchain.com/oss/deepagents/code/overview`          | Deep Agents CLI overview                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `rules`       | `https://docs.langchain.com/oss/deepagents/code/overview`          | AGENTS.md files, memory, persistent project context                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ignore`      | No dedicated upstream ignore surface in map                        | No Rulesync-supported Deep Agents ignore target in map                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mcp`         | `https://docs.langchain.com/oss/deepagents/code/overview`          | MCP tools surfaced through CLI configuration                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `commands`    | No dedicated upstream commands surface in map                      | No Rulesync-supported Deep Agents commands target in map                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `subagents`   | `https://docs.langchain.com/oss/deepagents/code/overview`          | `task` delegation to subagents                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `skills`      | `https://docs.langchain.com/oss/deepagents/code/memory-and-skills` | `.deepagents/skills`, `.agents/skills`, `~/.deepagents/<agent>/skills` (`<agent>` defaults to `agent`), progressive skill loading                                                                                                                                                                                                                                                                                                                                                         |
| `hooks`       | `https://docs.langchain.com/oss/deepagents/code/hooks`             | Hooks v2 (GA in deepagents-code 0.1.52, 2026-08-04): `{ "hooks": { "<Event>": [ { matcher, hooks } ] } }` in project `.deepagents/hooks.json` (needs workspace trust), user `~/.deepagents/hooks.json`, and plugin manifests; 12 events across client-owned (SessionStart, UserPromptSubmit, SessionEnd, PermissionRequest, Notification) and server-owned (PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SubagentStart, SubagentStop). See the legacy-format note below |
| `permissions` | `https://docs.langchain.com/oss/deepagents/code/configuration`     | `[shell].allow_list` in the user config `~/.deepagents/config.toml` (global only; no project config file): executable names matched exactly against the first token of each pipeline segment, sentinels `all`/`recommended`; approval mode in `[startup]` (`mode`, `yolo_switcher`, `read_project_dotenv`); the Python extension gate in `[extensions]` (`enabled`, `trust`, `extra_paths`)                                                                                               |
| `extensions`  | `https://docs.langchain.com/oss/deepagents/code/configuration`     | Python extensions auto-loaded from the user's `~/.deepagents/extensions/` and the project's `<root>/.deepagents/extensions/`, plus the `dcode.extensions` entry-point group and `plugin.manifest.python_extensions` — see below                                                                                                                                                                                                                                                           |

The pre-v2 flat hooks list was documented for removal after **2026-09-01**, but
`hooks/legacy.py` and `hooks/migration.py` are still on `main` and
`hooks/models/config.py` still carries the compatibility `argv` field, so the
importer is still needed. Re-check before dropping it.

`extensions` is **not a Rulesync dimension and has no Deep Agents target** —
the extension files themselves are Python that a project author writes, not
config Rulesync generates. Its **gate** is authorable, through the `deepagents`
permissions override: `[extensions].enabled` and `[extensions].trust`
(`ask` / `always` / `never`) decide whether a checked-out project's
`.deepagents/extensions/*.py` is imported into the agent process, in the same
class as `[startup].mode`. `[extensions].extra_paths` is deliberately left out —
it names machine-local paths and only widens what loads.

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| paths         | `deepagents-paths.ts` — the `.deepagents` root and the `agent` global segment, plain literals; `deepagents.ts` maps them under `DEEPAGENTS_HOME` in global scope         |
| `rules`       | `.deepagents/AGENTS.md` (project) and `~/.deepagents/<agent>/AGENTS.md` (global; `<agent>` defaults to `agent`), root-only, in `deepagents-rule.ts`                      |
| `mcp`         | `.deepagents/.mcp.json`, `mcpServers`, and project/global handling in `deepagents-mcp.ts`                                                                                |
| `subagents`   | `.deepagents/agents` project subagent directory in `deepagents-subagent.ts`                                                                                              |
| `skills`      | `.deepagents/skills` project skill directory in `deepagents-skill.ts`                                                                                                    |
| `hooks`       | `.deepagents/hooks.json` in `deepagents-hooks.ts`: writes the v2 object keyed by event, still imports the pre-v2 flat list, `DEEPAGENTS_HOOK_EVENTS` mapping             |
| `permissions` | `~/.deepagents/config.toml` in `deepagents-permissions.ts`: `[shell].allow_list`, and the `deepagents.startup` / `deepagents.extensions` override blocks merged in place |
