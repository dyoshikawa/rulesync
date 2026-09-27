/**
 * Shell-aware helpers for anchoring `./` paths in hook commands to a tool's
 * project directory variable (e.g. `$CLAUDE_PROJECT_DIR`) and for stripping
 * that variable back off on import.
 *
 * Both directions share `findPathStarts`, so a position the import normalizes
 * is exactly a position the generate re-anchors: an imported hook keeps
 * resolving against the project root after a round trip, and a second import
 * is stable.
 */

/**
 * How the shell reads a position where a path may start:
 *
 * - `plain`: an unquoted word — at the top level, inside `$( … )`, `` ` … ` ``
 *   or `( … )`, or inside a single-quoted script handed to an inner shell
 *   (`bash -c '…'`), which the inner shell reads unquoted.
 * - `double`: right after a `"` that opens a word.
 * - `single`: right after a `'` that opens a word and is *not* a `-c` script,
 *   so its text is a literal the shell never expands.
 */
export type PathStartKind = "plain" | "double" | "single";

/** Characters after which an unquoted shell word can start. */
const PLAIN_WORD_BOUNDARIES = new Set([" ", "\t", "\n", ";", "&", "|", "(", "<", ">", "=", "`"]);

type Frame = {
  readonly kind: '"' | "'" | "$(" | "(" | "`";
  /** A single-quoted script handed to an inner shell via `-c`. */
  readonly innerShell?: boolean;
  /** Index of the frame's opening character. */
  readonly open: number;
};

/**
 * Scan a shell command and return every position where a path may start,
 * mapped to how the shell reads that position. Comments (`#` at a word start)
 * and the interior of literal single-quoted strings are never path starts, and
 * neither is a position after a backslash escape.
 */
export function findPathStarts(command: string): Map<number, PathStartKind> {
  const scan: Scan = { command, starts: new Map(), stack: [], escaped: -1 };
  for (let i = 0; i < command.length; i++) {
    const top = scan.stack.at(-1);
    if (top?.kind === "'") {
      scanSingleQuoted({ scan, top, i });
    } else if (command.charAt(i) === "\\") {
      // An escaped character is a literal and never starts a path.
      i++;
      scan.escaped = i;
    } else if (top?.kind === '"') {
      i = scanDoubleQuoted({ scan, i });
    } else {
      i = scanUnquoted({ scan, top, i });
    }
  }
  return scan.starts;
}

type Scan = {
  readonly command: string;
  readonly starts: Map<number, PathStartKind>;
  readonly stack: Frame[];
  /** Index of the last backslash-escaped character, which is part of a word. */
  escaped: number;
};

function followsBoundary({ scan, i }: { scan: Scan; i: number }): boolean {
  return (
    i === 0 || (PLAIN_WORD_BOUNDARIES.has(scan.command.charAt(i - 1)) && scan.escaped !== i - 1)
  );
}

/** Inside `'…'`: a literal, unless it is a script handed to an inner shell. */
function scanSingleQuoted({ scan, top, i }: { scan: Scan; top: Frame; i: number }): void {
  if (scan.command.charAt(i) === "'") {
    scan.stack.pop();
  } else if (top.innerShell && (i === top.open + 1 || followsBoundary({ scan, i }))) {
    scan.starts.set(i, "plain");
  }
}

/** Inside `"…"`: only a nested `$( … )` or `` ` … ` `` opens new words. */
function scanDoubleQuoted({ scan, i }: { scan: Scan; i: number }): number {
  const char = scan.command.charAt(i);
  if (char === '"') {
    scan.stack.pop();
  } else if (char === "`") {
    scan.stack.push({ kind: "`", open: i });
  } else if (char === "$" && scan.command.charAt(i + 1) === "(") {
    scan.stack.push({ kind: "$(", open: i + 1 });
    return i + 1;
  }
  return i;
}

/** Unquoted: the top level, `$( … )`, `` ` … ` `` or `( … )`. */
function scanUnquoted({ scan, top, i }: { scan: Scan; top: Frame | undefined; i: number }): number {
  const { command, starts, stack } = scan;
  const char = command.charAt(i);
  const startsWord = followsBoundary({ scan, i });
  if (startsWord) {
    starts.set(i, "plain");
  }
  if (char === "#" && startsWord) {
    // A comment runs to the end of the line.
    const newline = command.indexOf("\n", i);
    return newline === -1 ? command.length : newline - 1;
  }
  if (char === '"') {
    stack.push({ kind: '"', open: i });
    if (startsWord) starts.set(i + 1, "double");
  } else if (char === "'") {
    const innerShell = /(?:^|\s)-c\s*$/.test(command.slice(0, i));
    stack.push({ kind: "'", open: i, innerShell });
    if (startsWord && !innerShell) starts.set(i + 1, "single");
  } else {
    return scanNesting({ scan, top, i });
  }
  return i;
}

/** Track `` ` … ` ``, `$( … )` and `( … )` in unquoted text. */
function scanNesting({ scan, top, i }: { scan: Scan; top: Frame | undefined; i: number }): number {
  const { command, stack } = scan;
  const char = command.charAt(i);
  if (char === "`") {
    if (top?.kind === "`") stack.pop();
    else stack.push({ kind: "`", open: i });
  } else if (char === "$" && command.charAt(i + 1) === "(") {
    stack.push({ kind: "$(", open: i + 1 });
    return i + 1;
  } else if (char === "(") {
    stack.push({ kind: "(", open: i });
  } else if (char === ")" && (top?.kind === "$(" || top?.kind === "(")) {
    stack.pop();
  }
  return i;
}

/**
 * Whether the command changes its working directory (`cd`, `pushd`, `popd`),
 * after which a later `./` path no longer means the project root. Such
 * commands are converted only in their first word, in both directions.
 */
export function changesDirectory(command: string): boolean {
  return /(?:^|[\s;&|(){`'"])(?:cd|pushd|popd)(?:\s|$)/.test(command);
}

/**
 * Anchor every `./` path that starts a word (as found by `findPathStarts`)
 * with the project directory variable, the inverse of
 * `stripProjectDirVariable`:
 *
 * - an unquoted `./x` becomes `"$VAR"/x`;
 * - `"./x"` becomes `"$VAR/x"`, which the double quotes keep as one word;
 * - a literal `'./x'` becomes `"$VAR"/'x'`, since single quotes never expand.
 *
 * Only an explicit `./` is anchored — never `../` or a bare `.name`. A command
 * that changes directory is returned unchanged.
 */
export function anchorDotPaths({
  command,
  projectDirVar,
}: {
  command: string;
  projectDirVar: string;
}): string {
  if (!command.includes("./") || changesDirectory(command)) {
    return command;
  }
  const edits = [...findPathStarts(command)]
    .filter(([index]) => command.startsWith("./", index))
    .toSorted(([a], [b]) => b - a);
  let result = command;
  for (const [index, kind] of edits) {
    if (kind === "plain") {
      result = `${result.slice(0, index)}"${projectDirVar}"/${result.slice(index + 2)}`;
    } else if (kind === "double") {
      result = `${result.slice(0, index)}${projectDirVar}/${result.slice(index + 2)}`;
    } else {
      // Move the opening single quote after the variable: './x' -> "$VAR"/'x'.
      result = `${result.slice(0, index - 1)}"${projectDirVar}"/'${result.slice(index + 2)}`;
    }
  }
  return result;
}

/**
 * Rewrite references to the project directory variable in a command to the
 * portable `./` form, the inverse of `anchorDotPaths`.
 *
 * The variable is normalized wherever a path starts with it, not only as the
 * first word, so interpreter-prefixed commands (`python3 "$VAR/x.py"`,
 * `node $VAR/x.js`) do not leak a tool-specific variable into targets that do
 * not define it. The recognized forms, each followed by `/`, are `"$VAR"`,
 * `"${VAR}"`, `$VAR` and `${VAR}`:
 *
 * - a quote around the whole path is kept, so a path containing spaces stays
 *   one word (`"$VAR/my hook.sh"` becomes `"./my hook.sh"`);
 * - a quoted path right after a quoted variable (`"$VAR"/'my hook.sh'`) has
 *   its quote moved in front of `./` (`'./my hook.sh'`).
 *
 * Left untouched: an escaped `\$VAR`, a longer name such as `$VAR_2`, a bare
 * `$VAR` not followed by `/`, a variable that does not start a path (`a:$VAR/x`),
 * one inside a literal single-quoted string or a comment, and — in a command
 * that changes directory or starts with another variable — every occurrence
 * after the first word, since generate only re-anchors that one there.
 */
export function stripProjectDirVariable({
  command,
  projectDirVar,
}: {
  command: string;
  projectDirVar: string;
}): string {
  const name = projectDirVar.replace(/^\$/, "");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const variable = `\\$(?:${escapedName}|\\{${escapedName}\\})`;
  const pattern = new RegExp(`(?:"${variable}"/(["']?)|${variable}/)`, "g");

  const leading = command.length - command.trimStart().length;
  // The first word may open with a quote: `"$VAR/x.sh"`.
  const inFirstWord = (offset: number): boolean =>
    offset === leading || (offset === leading + 1 && command.charAt(leading) === '"');
  const startsWithOtherVariable =
    command.charAt(leading) === "$" && !new RegExp(`^${variable}/`).test(command.slice(leading));
  const convertsLaterWords = !changesDirectory(command) && !startsWithOtherVariable;
  const starts = findPathStarts(command);

  return command.replace(pattern, (match: string, quote: string | undefined, offset: number) => {
    if (!convertsLaterWords && !inFirstWord(offset)) return match;
    const kind = starts.get(offset);
    if (kind !== "plain" && kind !== "double") return match;
    return `${quote ?? ""}./`;
  });
}
