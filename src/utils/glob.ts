/**
 * Convert a glob-like pattern into an anchored regex source string.
 *
 * Only `*` (any run of characters) and `?` (one character) carry meaning;
 * every other regex metacharacter is escaped so it matches literally. The
 * result is anchored at both ends, because the callers ask "is this the whole
 * name?" rather than "does this appear somewhere in it?".
 *
 * Note that `[` and `]` are escaped along with everything else, so a bracket
 * class is a literal here while `matchesGlob` below reads it as a class. The
 * one caller wants exactly that: AugmentCode writes this source into its own
 * config as the tool's own shell-command regex, and never executes it, so it
 * has to say what the tool would read rather than what a glob means. Use
 * `matchesGlob` for an actual comparison.
 */
export function globToAnchoredRegexSource(glob: string): string {
  let source = "";
  for (const char of glob) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if (/[\\^$.|+(){}[\]]/.test(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return `^${source}$`;
}

/** One step of a parsed glob, in the order the characters appeared. */
type GlobStep =
  | { kind: "star" }
  | { kind: "any" }
  | { kind: "literal"; character: string }
  | { kind: "class"; negated: boolean; members: ReadonlySet<string>; ranges: [number, number][] };

/**
 * Read a `[...]` class body starting just past the `[`, or `undefined` when the
 * bracket is never closed — in which case it is an ordinary character.
 */
function parseGlobClass(
  characters: readonly string[],
  start: number,
): { step: GlobStep; next: number } | undefined {
  let index = start;
  const negated = characters[index] === "!" || characters[index] === "^";
  if (negated) {
    index += 1;
  }
  const members = new Set<string>();
  const ranges: [number, number][] = [];
  // A `]` in the first position is a member rather than the terminator.
  let first = true;
  while (index < characters.length) {
    const character = characters[index] ?? "";
    if (character === "]" && !first) {
      return { step: { kind: "class", negated, members, ranges }, next: index + 1 };
    }
    first = false;
    const high = characters[index + 2];
    if (characters[index + 1] === "-" && high !== undefined && high !== "]") {
      ranges.push([character.codePointAt(0) ?? 0, high.codePointAt(0) ?? 0]);
      index += 3;
      continue;
    }
    members.add(character);
    index += 1;
  }
  return undefined;
}

/** Split a glob into the steps `matchesGlob` walks. */
function parseGlob(glob: string): GlobStep[] {
  const characters = [...glob];
  const steps: GlobStep[] = [];
  let index = 0;
  // Once a `[` has failed to find its `]`, no later one can find one either —
  // there is no `]` left in the string. Remembering that keeps a pattern of
  // nothing but `[` linear instead of scanning to the end for every bracket.
  let bracketsAreClosed = true;
  while (index < characters.length) {
    const character = characters[index] ?? "";
    index += 1;
    if (character === "*") {
      // A run of stars says exactly what one says.
      if (steps.at(-1)?.kind !== "star") {
        steps.push({ kind: "star" });
      }
      continue;
    }
    if (character === "?") {
      steps.push({ kind: "any" });
      continue;
    }
    if (character === "[" && bracketsAreClosed) {
      const parsed = parseGlobClass(characters, index);
      if (parsed === undefined) {
        bracketsAreClosed = false;
      } else {
        steps.push(parsed.step);
        index = parsed.next;
        continue;
      }
    }
    steps.push({ kind: "literal", character });
  }
  return steps;
}

function matchesGlobStep(step: GlobStep, character: string): boolean {
  if (step.kind === "star") return false;
  if (step.kind === "any") return true;
  if (step.kind === "literal") return step.character === character;
  const code = character.codePointAt(0) ?? 0;
  const admitted =
    step.members.has(character) || step.ranges.some(([low, high]) => code >= low && code <= high);
  return step.negated ? !admitted : admitted;
}

/**
 * Whether `value` matches `glob` in full, with `*`, `?` and `[...]` carrying
 * their usual meaning. The glob comes first, unlike Node's own
 * `path.matchesGlob(path, pattern)`.
 *
 * The glob is walked step by step rather than translated to a regex, because
 * both sides of a comparison can come from a file a repository carries: `*a*a*a*a*b`
 * translated to `^.*a.*a.*a.*a.*b$` takes minutes against a forty-character
 * name, while walking the steps is linear in the name per `*`. Remembering only
 * the most recent `*` to fall back to is enough — an earlier one can always give
 * up whatever the later one needed.
 */
export function matchesGlob(glob: string, value: string): boolean {
  return compileGlob(glob)(value);
}

/**
 * Parse `glob` once and return a predicate that walks it, for a caller that
 * tests the same glob against a whole list of names.
 */
export function compileGlob(glob: string): (value: string) => boolean {
  const steps = parseGlob(glob);
  return (value) => matchesParsedGlob(steps, value);
}

function matchesParsedGlob(steps: readonly GlobStep[], value: string): boolean {
  const characters = [...value];
  let stepIndex = 0;
  let characterIndex = 0;
  let starStepIndex = -1;
  let starCharacterIndex = 0;
  while (characterIndex < characters.length) {
    const step = steps[stepIndex];
    if (step?.kind === "star") {
      starStepIndex = stepIndex;
      starCharacterIndex = characterIndex;
      stepIndex += 1;
      continue;
    }
    if (step !== undefined && matchesGlobStep(step, characters[characterIndex] ?? "")) {
      stepIndex += 1;
      characterIndex += 1;
      continue;
    }
    if (starStepIndex < 0) {
      return false;
    }
    starCharacterIndex += 1;
    stepIndex = starStepIndex + 1;
    characterIndex = starCharacterIndex;
  }
  let remaining = stepIndex;
  while (steps[remaining]?.kind === "star") {
    remaining += 1;
  }
  return remaining === steps.length;
}

/** Whether two single-character steps can both match one same character. */
function stepsShareACharacter(left: GlobStep, right: GlobStep): boolean {
  if (left.kind === "any" || right.kind === "any") {
    return true;
  }
  if (left.kind === "literal" && right.kind === "literal") {
    return left.character === right.character;
  }
  if (left.kind === "literal") {
    return matchesGlobStep(right, left.character);
  }
  if (right.kind === "literal") {
    return matchesGlobStep(left, right.character);
  }
  // Two classes. Reading whether their members overlap would mean expanding
  // ranges, so they are assumed to overlap: over-reporting an intersection
  // only withholds an `allow`, which is the safe direction.
  return true;
}

/** Whether every step from `index` on can match the empty string. */
function isAllStars(steps: readonly GlobStep[], index: number): boolean {
  for (let step = index; step < steps.length; step++) {
    if (steps[step]?.kind !== "star") {
      return false;
    }
  }
  return true;
}

/**
 * The most work one intersection walk will do, counted in cells times the cost
 * of one. Past it the two patterns are reported as intersecting without being
 * walked: the product of two lengths grows quadratically, and a pattern long
 * enough to reach this is pathological rather than a command anybody typed.
 * Answering `true` withholds an `allow`, which is the direction that fails
 * closed.
 */
const MAX_INTERSECTION_CELLS = 1_000_000;

/**
 * The most work a whole run of comparisons will do. A caller holding R
 * restrictions and A allow rules asks R x A times, and a per-pair cap alone
 * bounds none of that: a hundred restrictions against a hundred allow rules,
 * each pattern just under the per-pair cap, is ten thousand affordable walks
 * that together take minutes. The shared budget is spent down across the run
 * and, once it is gone, every remaining pair is reported as intersecting —
 * again the direction that withholds an `allow` rather than writing one.
 */
const MAX_TOTAL_INTERSECTION_CELLS = 10_000_000;

/**
 * What a pair costs before a single cell of it is walked: parsing the pattern
 * the caller holds on one side, dispatching, sizing the table. Charging only
 * cells would leave the *number* of pairs unbounded — a pair of one-step
 * patterns walks a single cell, so n short restrictions against n short allow
 * rules is n squared comparisons that never spend the budget down however many
 * of them there are. Charging a floor per pair puts pair count and walk length
 * on the same exhaustible resource.
 */
const INTERSECTION_PAIR_COST = 64;

/** What a run of comparisons has left to spend; see `createIntersectionBudget`. */
export type IntersectionBudget = { remaining: number };

/**
 * A budget for one caller's run of comparisons. Hand the same one to every
 * `parsedGlobsIntersect` call that belongs together — one adapter reading one
 * config — so the run as a whole stays bounded rather than only each pair in
 * it.
 */
export function createIntersectionBudget(
  remaining: number = MAX_TOTAL_INTERSECTION_CELLS,
): IntersectionBudget {
  return { remaining };
}

/** A glob parsed once, for a caller that compares it more than once. */
export type ParsedGlob = { steps: GlobStep[]; maxRanges: number };

/**
 * Parse `glob` into the form `parsedGlobsIntersect` walks. A caller comparing
 * the same pattern against a whole list parses it once and reuses the result.
 */
export function parseGlobPattern(glob: string): ParsedGlob {
  const steps = parseGlob(glob);
  return { steps, maxRanges: maxRangeCount(steps) };
}

/**
 * What one cell can cost, as a multiplier on the cell count. A literal met by a
 * `[a-z...]` class walks that class's ranges, so a single class carrying
 * thousands of them turns a walk that looks affordable by cell count alone into
 * a quadratic one — which is why the budget is spent on cells times this rather
 * than on cells.
 */
function maxRangeCount(steps: readonly GlobStep[]): number {
  let most = 0;
  for (const step of steps) {
    if (step.kind === "class" && step.ranges.length > most) {
      most = step.ranges.length;
    }
  }
  return most;
}

/**
 * Whether any one value matches both globs — that is, whether the two patterns
 * overlap at all. The answer is exact up to `MAX_INTERSECTION_CELLS`; a pair
 * longer than that is reported as overlapping without being compared, so a
 * caller that reads a `true` as a reason to restrict stays on the safe side and
 * one that would read it as a reason to permit must not use this. What a pair
 * costs counts the ranges a `[a-z]` class carries, not only the two lengths.
 *
 * This answers the question an adapter really has when it holds a restriction
 * and an `allow`: is there a command both of them name? Asking instead whether
 * either pattern covers the other's *text* misses the ordinary crossing pair —
 * `* --force` and `git *` cover none of each other's spellings, yet they share
 * every `git … --force` command.
 *
 * The two step lists are walked as a table rather than by backtracking, so no
 * input makes the time blow up the way a translated regex would. Only two rows
 * of that table are ever held, and the shorter pattern is the one that sizes
 * them, so the memory is linear in the shorter pattern however long the other
 * one is. Where a `[...]` class meets another `[...]` class the answer is
 * assumed to be yes, which over-reports rather than misses.
 */
export function globsIntersect(left: string, right: string): boolean {
  return parsedGlobsIntersect(parseGlobPattern(left), parseGlobPattern(right));
}

/**
 * `globsIntersect` for two globs already parsed, optionally spending a budget
 * shared with the rest of the caller's run — see `createIntersectionBudget`.
 * Once that budget is exhausted every further pair answers `true` without being
 * walked, so a caller reading the answer as a reason to restrict stays on the
 * safe side.
 */
export function parsedGlobsIntersect(
  left: ParsedGlob,
  right: ParsedGlob,
  budget?: IntersectionBudget,
): boolean {
  // The walk is symmetric, so the shorter list can always be the one held in a
  // row — `columns` below is its length.
  const [rows, columns] =
    left.steps.length >= right.steps.length ? [left.steps, right.steps] : [right.steps, left.steps];
  const cellCost = 1 + left.maxRanges + right.maxRanges;
  const cost = rows.length * columns.length * cellCost;
  if (cost > MAX_INTERSECTION_CELLS) {
    return true;
  }
  if (budget !== undefined) {
    const charge = cost + INTERSECTION_PAIR_COST;
    if (charge > budget.remaining) {
      // Spent to the last cell rather than left at whatever fell short of this
      // pair: a cheaper pair later must not slip through a budget this one
      // already ended.
      budget.remaining = 0;
      return true;
    }
    budget.remaining -= charge;
  }

  // `row[j]` — can the steps from the current row index and from `j` on produce
  // one same remaining string? Filled from the end so each cell reads finished
  // ones: `next` is the row below, `row` the one being filled.
  let next: boolean[] = Array.from({ length: columns.length + 1 }, (_, j) =>
    isAllStars(columns, j),
  );
  for (let i = rows.length - 1; i >= 0; i--) {
    const row: boolean[] = Array.from({ length: columns.length + 1 }, () => false);
    row[columns.length] = isAllStars(rows, i);
    for (let j = columns.length - 1; j >= 0; j--) {
      const rowStep = rows[i];
      const columnStep = columns[j];
      if (rowStep === undefined || columnStep === undefined) {
        continue;
      }
      if (rowStep.kind === "star" || columnStep.kind === "star") {
        // A `*` either matches nothing and steps aside, or swallows whatever
        // one character the other side produces next.
        row[j] = (next[j] ?? false) || (row[j + 1] ?? false);
        continue;
      }
      row[j] = stepsShareACharacter(rowStep, columnStep) && (next[j + 1] ?? false);
    }
    next = row;
  }
  return next[0] ?? false;
}
