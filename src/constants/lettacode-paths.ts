import { join } from "node:path";

// Letta Code (`@letta-ai/letta-code` on npm, the `letta` CLI) keeps its
// project-scoped configuration under a `.letta/` directory at the project root
// and the matching user-scoped configuration under `~/.letta/`.
// @see https://docs.letta.com/reference/settings/index.md
export const LETTACODE_DIR = ".letta";

// Settings. `.letta/settings.json` (shared project settings) and
// `~/.letta/settings.json` (user settings) carry the `permissions` and `hooks`
// keys beside other user-tunable settings, so rulesync merges its keys in
// place and leaves the siblings alone.
// @see https://docs.letta.com/reference/settings/index.md
// @see https://github.com/letta-ai/letta-code/blob/main/src/hooks/loader.ts
export const LETTACODE_SETTINGS_FILE_NAME = "settings.json";

// Personal project settings, documented as "personal, gitignored". Never
// emitted by rulesync; only listed for the generated `.gitignore`.
// @see https://docs.letta.com/reference/settings/index.md
export const LETTACODE_SETTINGS_LOCAL_FILE_NAME = "settings.local.json";

// Ignore file: `.letta/.lettaignore` excludes files from the indexed `@` file
// search, one glob per line, without `!` negation.
// @see https://docs.letta.com/reference/settings/index.md
export const LETTACODE_IGNORE_FILE_NAME = ".lettaignore";

// Subagents: Markdown files with YAML frontmatter under `.letta/agents/`
// (project) and `~/.letta/agents/` (user).
// @see https://docs.letta.com/configuration/subagents/index.md
export const LETTACODE_AGENTS_DIR_PATH = join(LETTACODE_DIR, "agents");

// Skills: `<name>/SKILL.md` directories. The project root is the shared
// `.agents/skills/`; the user root is `~/.letta/skills/`.
// @see https://docs.letta.com/configuration/skills/index.md
export const LETTACODE_PROJECT_SKILLS_DIR_PATH = join(".agents", "skills");
export const LETTACODE_GLOBAL_SKILLS_DIR_PATH = join(LETTACODE_DIR, "skills");
