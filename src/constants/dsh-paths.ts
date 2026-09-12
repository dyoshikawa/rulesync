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
