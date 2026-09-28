import { join } from "node:path";

/**
 * DeepSeek Harness (`dsh`) configuration-layout conventions.
 *
 * The harness home is `$DSH_HOME`, which defaults to `~/.dsh`; rulesync writes
 * only the default location. Project-scoped assets live under a `.dsh/`
 * directory at the project root.
 *
 * Rules: `dsh-agent-instructions` loads the user-global `$DSH_HOME/AGENTS.md`
 * (root file only — the user-global file has no `.local.md` overlay), then the
 * project chain of `AGENTS.md` / `CLAUDE.md` files from the project root (the
 * nearest ancestor holding `.git`) down to the session cwd, broad to specific.
 * Rulesync emits `AGENTS.md` only; `CLAUDE.md` is the `claudecode` target's
 * file, and a `CLAUDE.md` duplicating its sibling `AGENTS.md` renders once.
 *
 * Skills: `dsh-skill-filesystem` scans `<projectRoot>/.dsh/skills` (rank 100),
 * `<projectRoot>/.agents/skills` (200), `<dshHome>/skills` (400) and
 * `<agentsHome>/skills` (500), each holding top-level `<name>/SKILL.md`
 * bundles or flat `<name>.md` files; nested `SKILL.md` files are deliberately
 * not discovered. Rulesync writes only the `dsh`-specific roots — the
 * `.agents/skills` roots are the `agentsskills` target's output.
 *
 * @see https://github.com/deepseek-ai/deepseek-harness
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md
 */

/**
 * Project-scoped `.dsh/` directory, and the harness home relative to the home
 * directory (`$DSH_HOME` default).
 */
export const DSH_DIR = ".dsh";

/** Skills root, relative to the project root or the harness home. */
export const DSH_SKILLS_DIR_PATH = join(DSH_DIR, "skills");

/**
 * Home-level Cordis patch layer (`$DSH_HOME/cordis.patch.yml`), the
 * "machine-local preferences shared by every profile" that outranks each
 * profile's own `cordis.patch.yml`. Its root is a YAML list of patch entries;
 * MCP servers are persisted there as `insert` rows of
 * {@link DSH_MCP_CLIENT_PLUGIN_NAME}. Rulesync writes only this home file: the
 * per-profile `profiles/<name>/cordis.patch.yml` is also written by the app
 * itself (the GUI Plugin Manager and settings, since v0.1.6-alpha.2).
 *
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md
 */
export const DSH_CORDIS_PATCH_FILE_NAME = "cordis.patch.yml";

/** The Cordis plugin that connects one MCP server per `insert` row. */
export const DSH_MCP_CLIENT_PLUGIN_NAME = "@deepseek-ai/dsh-mcp-client";
