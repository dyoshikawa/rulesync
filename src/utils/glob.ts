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
 * Whether any one value matches both globs — that is, whether the two patterns
 * overlap at all.
 *
 * This answers the question an adapter really has when it holds a restriction
 * and an `allow`: is there a command both of them name? Asking instead whether
 * either pattern covers the other's *text* misses the ordinary crossing pair —
 * `* --force` and `git *` cover none of each other's spellings, yet they share
 * every `git … --force` command.
 *
 * The two step lists are walked as a table rather than by backtracking, so the
 * cost is the product of the two pattern lengths and no input makes it blow up.
 * Where a `[...]` class meets another `[...]` class the answer is assumed to be
 * yes, which over-reports rather than misses.
 */
export function globsIntersect(left: string, right: string): boolean {
  const leftSteps = parseGlob(left);
  const rightSteps = parseGlob(right);
  // `table[i][j]` — can the steps from `i` and from `j` on produce one same
  // remaining string? Filled from the end so each cell reads finished ones.
  const table: boolean[][] = Array.from({ length: leftSteps.length + 1 }, () =>
    Array.from({ length: rightSteps.length + 1 }, () => false),
  );
  for (let i = leftSteps.length; i >= 0; i--) {
    for (let j = rightSteps.length; j >= 0; j--) {
      const row = table[i];
      if (row === undefined) {
        continue;
      }
      if (i === leftSteps.length) {
        row[j] = isAllStars(rightSteps, j);
        continue;
      }
      if (j === rightSteps.length) {
        row[j] = isAllStars(leftSteps, i);
        continue;
      }
      const leftStep = leftSteps[i];
      const rightStep = rightSteps[j];
      if (leftStep === undefined || rightStep === undefined) {
        continue;
      }
      if (leftStep.kind === "star" || rightStep.kind === "star") {
        // A `*` either matches nothing and steps aside, or swallows whatever
        // one character the other side produces next.
        row[j] = (table[i + 1]?.[j] ?? false) || (row[j + 1] ?? false);
        continue;
      }
      row[j] = stepsShareACharacter(leftStep, rightStep) && (table[i + 1]?.[j + 1] ?? false);
    }
  }
  return table[0]?.[0] ?? false;
}
