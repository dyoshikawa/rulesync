import { join } from "node:path";

export const FACTORYDROID_DIR = ".factory";
export const FACTORYDROID_COMMANDS_DIR_PATH = join(FACTORYDROID_DIR, "commands");
export const FACTORYDROID_SKILLS_DIR_PATH = join(FACTORYDROID_DIR, "skills");
export const FACTORYDROID_DROIDS_DIR_PATH = join(FACTORYDROID_DIR, "droids");
export const FACTORYDROID_RULE_FILE_NAME = "AGENTS.md";

/**
 * Factory Droid's design-guidelines instruction file: "Always-on design-system,
 * UX, visual, and interaction guidance", loaded separately from `AGENTS.md`'s
 * coding guidelines. Project scope only — Factory's docs describe root and
 * nested `DESIGN.md` files like `AGENTS.md`, but document no personal/global
 * home-directory equivalent.
 * @see https://docs.factory.ai/cli/configuration/agents-md
 */
export const FACTORYDROID_DESIGN_FILE_NAME = "DESIGN.md";

/**
 * Factory's Security Review threat model, kept inside the tool directory:
 * "if `.factory/threat-model.md` exists, Droid uses it as the attack-surface
 * map". Documented only as a repository file, so project scope only.
 * @see https://docs.factory.ai/software-factory/security-review
 */
export const FACTORYDROID_THREAT_MODEL_FILE_NAME = "threat-model.md";

/**
 * Factory Droid's custom output styles: "Droid loads direct `.md` children of
 * each `output-styles` directory", at `<repo>/.factory/output-styles/` and
 * `~/.factory/output-styles/` alike. Relative to the `.factory` directory.
 * @see https://docs.factory.ai/droid-cli/output-styles
 */
export const FACTORYDROID_OUTPUT_STYLES_DIR_NAME = "output-styles";

/**
 * The built-in output styles Droid reserves: "The built-in `Default` and
 * `Concise` styles are reserved and cannot be replaced." Compared
 * case-insensitively against a custom style's name.
 * @see https://docs.factory.ai/droid-cli/output-styles
 */
export const FACTORYDROID_RESERVED_OUTPUT_STYLE_NAMES: ReadonlyArray<string> = [
  "default",
  "concise",
];
export const FACTORYDROID_MCP_FILE_NAME = "mcp.json";
export const FACTORYDROID_SETTINGS_FILE_NAME = "settings.json";
export const FACTORYDROID_HOOKS_FILE_NAME = "hooks.json";

/**
 * Personal settings Droid merges on top of `settings.json` at the same scope.
 * Factory tells users to keep it out of version control, so rulesync reads it
 * on import and never writes it.
 * @see https://docs.factory.ai/droid-cli/settings
 */
export const FACTORYDROID_SETTINGS_LOCAL_FILE_NAME = "settings.local.json";

/**
 * The pre-1.0 hooks location Droid still reads when `.factory/hooks.json` is
 * absent. Droid renames it to `hooks.migrated.json` once it has migrated the
 * file, so rulesync only ever reads it.
 * @see https://docs.factory.ai/harness/hooks
 */
export const FACTORYDROID_LEGACY_HOOKS_DIR_PATH = join(FACTORYDROID_DIR, "hooks");

/**
 * Factory's automated code review looks for a skill by name, so the checks
 * output is `.factory/skills/review-guidelines/SKILL.md` rather than a file of
 * its own: "Add repository-specific review guidelines by creating a
 * `.factory/skills/review-guidelines/SKILL.md` file in your repo".
 * @see https://docs.factory.ai/software-factory/code-review-ci
 */
export const FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME = "review-guidelines";
export const FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH = join(
  FACTORYDROID_SKILLS_DIR_PATH,
  FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME,
);
