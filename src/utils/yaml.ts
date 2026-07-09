import { load, YAMLException } from "js-yaml";

/**
 * js-yaml v5's `reason` for an empty document. `load("")` — and any
 * whitespace/comment-only input — throws a `YAMLException` with this reason
 * instead of returning `undefined` the way v4 did.
 */
const EMPTY_INPUT_REASON = "expected a document, but the input is empty";

/**
 * Load YAML content while preserving js-yaml v4's behavior of returning
 * `undefined` for empty documents (empty, whitespace-only, or comment-only
 * input).
 *
 * js-yaml v5 changed `load("")` to **throw** ("expected a document, but the
 * input is empty") instead of returning `undefined`. Many call sites here parse
 * config/lock/frontmatter files that can legitimately be empty and rely on the
 * old `undefined` sentinel (`load(input) ?? {}`, `if (loaded === undefined)`,
 * "an empty file parses to undefined/null"). Routing every load through this
 * wrapper keeps that contract in one place so a future js-yaml bump cannot
 * reintroduce the empty-input regression. Genuine parse errors still propagate.
 *
 * @see https://github.com/nodeca/js-yaml/blob/master/docs/migrate_v4_to_v5.md#empty-input-throws
 */
export function loadYaml(content: string): unknown {
  if (content.trim() === "") {
    return undefined;
  }
  try {
    return load(content);
  } catch (error) {
    // A comment-only document is not caught by the whitespace guard above but is
    // still an "empty document" in v5. Preserve the v4 `undefined` contract for
    // that specific case only; any other parse error is re-thrown.
    if (error instanceof YAMLException && error.reason === EMPTY_INPUT_REASON) {
      return undefined;
    }
    throw error;
  }
}
