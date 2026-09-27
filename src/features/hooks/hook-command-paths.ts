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
 *   or `( … )`.
 * - `double`: right after a `"` that opens a word.
 * - `single`: right after a `'` that opens a word, so its text is a literal the
 *   shell never expands.
 *
 * A single-quoted script handed to an inner shell (`bash -c '…'`) is scanned
 * as a command of its own, since the inner shell parses it again; a
 * double-quoted one is not, since the outer shell has already expanded it.
 */
export type PathStartKind = "plain" | "double" | "single";

/** Characters after which an unquoted shell word can start. */
const PLAIN_WORD_BOUNDARIES = new Set([" ", "\t", "\n", ";", "&", "|", "(", "<", ">", "=", "`"]);

type Frame = {
  readonly kind: '"' | "'" | "$(" | "(" | "`";
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
      if (command.charAt(i) === "'") scan.stack.pop();
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
    // A double-quoted `-c` script is expanded by the outer shell and then
    // re-split by the inner one, so an anchored path would not stay one word.
    if (startsWord && !isInnerShellScript({ command, i })) starts.set(i + 1, "double");
  } else if (char === "'") {
    if (isInnerShellScript({ command, i })) return scanInnerShellScript({ scan, i });
    stack.push({ kind: "'", open: i });
    if (startsWord) starts.set(i + 1, "single");
  } else if (char === "$" && command.charAt(i + 1) === "'") {
    // An ANSI-C `$'…'` string is a literal with backslash escapes.
    return skipAnsiCString({ command, i });
  } else {
    return scanNesting({ scan, top, i });
  }
  return i;
}

/**
 * A single-quoted `-c` script is passed verbatim to an inner shell, which reads
 * it as a command of its own: scan it the same way, including its own quotes,
 * and continue after the closing quote.
 */
function scanInnerShellScript({ scan, i }: { scan: Scan; i: number }): number {
  const close = scan.command.indexOf("'", i + 1);
  const end = close === -1 ? scan.command.length : close;
  for (const [index, kind] of findPathStarts(scan.command.slice(i + 1, end))) {
    scan.starts.set(i + 1 + index, kind);
  }
  return end;
}

/** Return the index of the quote closing the `$'…'` string opened at `i`. */
function skipAnsiCString({ command, i }: { command: string; i: number }): number {
  for (let j = i + 2; j < command.length; j++) {
    if (command.charAt(j) === "\\") j++;
    else if (command.charAt(j) === "'") return j;
  }
  return command.length;
}

/**
 * Longest command prefix inspected before a quote to decide whether it opens a
 * `-c` script; bounding it keeps the scan linear in the command length.
 */
const INNER_SHELL_LOOKBEHIND = 256;

/**
 * A shell invocation (`sh`, `ash`, `bash`, `dash`, `ksh`, `mksh`, `zsh`,
 * optionally with a directory) whose last option cluster contains `c` (`-c`,
 * `-lc`, `-euc`), possibly after other options such as `-o pipefail` or
 * `--norc` and followed by `--`. Other commands' `-c` options (`git -c`,
 * `grep -c`, `head -c`) do not match.
 */
const INNER_SHELL_PATTERN =
  /(?:^|[\s;&|(`])(?:\S*\/)?(?:a|ba|da|k|mk|z)?sh(?:\s+(?:[-+]o\s+\w+|--?[A-Za-z][\w-]*|\+[A-Za-z]+))*\s+-[A-Za-z]*c[A-Za-z]*(?:\s+--)?\s*$/;

/** Whether the quote at `i` opens a script handed to an inner shell via `-c`. */
function isInnerShellScript({ command, i }: { command: string; i: number }): boolean {
  const start = Math.max(0, i - INNER_SHELL_LOOKBEHIND);
  const tail = command.slice(start, i);
  // A cut-off prefix may begin mid-word, which must not count as a word start.
  return INNER_SHELL_PATTERN.test(start === 0 ? tail : tail.replace(/^\S*/, ""));
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
  return containsCommand({ command, names: "cd|pushd|popd" });
}

/** Whether one of the `|`-separated command names appears as a word. */
function containsCommand({ command, names }: { command: string; names: string }): boolean {
  return new RegExp(`(?:^|[\\s;&|(){\`'"])\\\\?(?:${names})(?:[\\s;&|()\`'"]|$)`).test(command);
}

/**
 * Whether `./` words after the first one are converted in both directions:
 * not after a directory change, not in a command with a heredoc or here-string
 * (`<<`), whose body is data rather than shell words, and not with `eval`,
 * which would parse an expanded project path as shell code again.
 */
export function convertsLaterWords(command: string): boolean {
  return (
    !changesDirectory(command) &&
    !command.includes("<<") &&
    !containsCommand({ command, names: "eval" })
  );
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
 * whose later words are not converted (see `convertsLaterWords`) is returned
 * unchanged.
 */
export function anchorDotPaths({
  command,
  projectDirVar,
}: {
  command: string;
  projectDirVar: string;
}): string {
  if (!command.includes("./") || !convertsLaterWords(command)) {
    return command;
  }
  const edits = [...findPathStarts(command)]
    .filter(([index]) => command.startsWith("./", index))
    .toSorted(([a], [b]) => a - b);
  const parts: string[] = [];
  let copied = 0;
  for (const [index, kind] of edits) {
    if (kind === "single") {
      // Move the opening single quote after the variable: './x' -> "$VAR"/'x'.
      parts.push(command.slice(copied, index - 1), `"${projectDirVar}"/'`);
    } else {
      // Inside double quotes the variable needs no quotes of its own.
      const anchor = kind === "plain" ? `"${projectDirVar}"/` : `${projectDirVar}/`;
      parts.push(command.slice(copied, index), anchor);
    }
    copied = index + 2;
  }
  parts.push(command.slice(copied));
  return parts.join("");
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
  const laterWords = convertsLaterWords(command) && !startsWithOtherVariable;
  const starts = findPathStarts(command);

  return command.replace(pattern, (match: string, quote: string | undefined, offset: number) => {
    if (!laterWords && !inFirstWord(offset)) return match;
    const kind = starts.get(offset);
    if (kind !== "plain" && kind !== "double") return match;
    return `${quote ?? ""}./`;
  });
}
