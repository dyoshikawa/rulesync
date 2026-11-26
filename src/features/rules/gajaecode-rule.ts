import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import type { OmpLayout } from "../../constants/omp-paths.js";
import { OmpRule } from "./omp-rule.js";

/**
 * Rule generator for **Gajae-Code** (`gjc`), a descendant of oh-my-pi with the
 * same rule discovery, so this target reuses {@link OmpRule} with the `.gjc`
 * layout:
 *
 * - Root rule: `.gjc/AGENTS.md` (project) / `~/.gjc/agent/AGENTS.md` (global),
 *   the native context file. A project-root `AGENTS.md` is also native, but it
 *   belongs to the `agentsmd` target, so the two targets never write the same
 *   file.
 * - Non-root rules: `.gjc/rules/*.md` (project) / `~/.gjc/agent/rules/*.md`
 *   (global) with `description` / `globs` / `alwaysApply` frontmatter. Like
 *   oh-my-pi, Gajae-Code surfaces only an always-apply rule or one with a
 *   description, and reads the rules directory non-recursively.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/customization.md
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/rulebook-matching-pipeline.md
 */
export class GajaecodeRule extends OmpRule {
  protected static override readonly layout = GAJAECODE_LAYOUT;
  protected static override readonly toolTarget: OmpLayout["toolTarget"] = "gajaecode";
}
