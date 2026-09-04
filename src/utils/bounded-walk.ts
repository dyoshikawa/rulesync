/**
 * Shared bookkeeping for walks over a parsed YAML/JSON document that copy
 * every reachable value, used by the frontmatter cleaner and the shared-config
 * sanitizer.
 *
 * A YAML alias makes one parsed container reachable from many keys, and a
 * walk that copies each reachable value writes every alias out independently
 * (the writers dump with `noRefs`, so memoizing would only move the blowup
 * into serialization). Left unbounded, a small "alias bomb" of nested anchors
 * costs exponential time and memory, a long string aliased many times balloons
 * the output while staying within a value count, a chain of aliases that each
 * wrap the previous one overflows the call stack, and a self-referencing
 * anchor recurses forever. The walk therefore charges every value against
 * `maxValues`, every string leaf and mapping key against `maxStringChars`,
 * caps nesting at `maxDepth`, and tracks the containers on the current
 * descent path so a reference back to one of them is recognized as a cycle.
 * Each bound trips with a clear error naming the document kind, instead of a
 * hang or a crash.
 */

export type BoundedWalkLimits = {
  /** Values the document may expand to once every alias is written out. */
  maxValues: number;
  /** Total characters of string leaves and mapping keys the document may expand to. */
  maxStringChars: number;
  /** Containers deep the document may nest. */
  maxDepth: number;
};

export type BoundedWalk = {
  /**
   * Charge one visited value, plus the characters of a string leaf (or the
   * serialized size of a leaf that is not a string), against the budgets.
   */
  chargeValue: (stringChars?: number) => void;
  /** Charge string content that is not itself a value, such as a mapping key. */
  chargeChars: (chars: number) => void;
  /** Whether `container` is on the current descent path, i.e. entering it would close a cycle. */
  isAncestor: (container: object) => boolean;
  /** Enter one more container level, throwing if the depth cap is exceeded. */
  enter: (container: object) => void;
  /** Leave a container level entered via `enter`. */
  leave: (container: object) => void;
};

const ALIAS_HINT = "(a chain of YAML aliases may be amplifying the document)";

/**
 * Create the bookkeeping for one walk. `subject` names the document kind in
 * every error ("Frontmatter", "Shared config"); `root`, when given, is entered
 * up front so the root object counts as the first nesting level, matching the
 * +1 that `enter` applies to every container nested inside it.
 */
export function createBoundedWalk({
  subject,
  limits,
  root,
}: {
  subject: string;
  limits: BoundedWalkLimits;
  root?: object;
}): BoundedWalk {
  const ancestors = new WeakSet<object>();
  let valuesRemaining = limits.maxValues;
  let stringCharsRemaining = limits.maxStringChars;
  let depth = 0;

  const chargeChars = (chars: number): void => {
    stringCharsRemaining -= chars;
    if (stringCharsRemaining < 0) {
      throw new Error(
        `${subject}'s string values expand to more than ${limits.maxStringChars} characters; refusing to process it ${ALIAS_HINT}`,
      );
    }
  };

  const chargeValue = (stringChars = 0): void => {
    valuesRemaining -= 1;
    if (valuesRemaining < 0) {
      throw new Error(
        `${subject} expands to more than ${limits.maxValues} values; refusing to process it ${ALIAS_HINT}`,
      );
    }
    chargeChars(stringChars);
  };

  const enter = (container: object): void => {
    depth += 1;
    if (depth > limits.maxDepth) {
      throw new Error(
        `${subject} nests more than ${limits.maxDepth} levels deep; refusing to process it ${ALIAS_HINT}`,
      );
    }
    ancestors.add(container);
  };

  const leave = (container: object): void => {
    ancestors.delete(container);
    depth -= 1;
  };

  if (root !== undefined) {
    enter(root);
  }

  return {
    chargeValue,
    chargeChars,
    isAncestor: (container) => ancestors.has(container),
    enter,
    leave,
  };
}
