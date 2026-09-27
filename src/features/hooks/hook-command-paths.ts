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

/** Characters that end one simple command and start the next. */
const COMMAND_SEPARATORS = new Set([";", "&", "|", "\n"]);

type Frame = { readonly kind: '"' | "'" | "$(" | "(" | "`" };

/** A shell word, and whether it is the first word of a simple command. */
type Word = { readonly index: number; readonly commandStart: boolean };

/**
 * Scan a shell command and return every position where a path may start,
 * mapped to how the shell reads that position. Comments (`#` at a word start)
 * and the interior of literal single-quoted strings are never path starts, and
 * neither is a position after a backslash escape.
 */
export function findPathStarts(command: string): Map<number, PathStartKind> {
  return scanCommand(command).starts;
}

function scanCommand(command: string): Scan {
  const scan: Scan = {
    command,
    starts: new Map(),
    words: [],
    stack: [],
    escaped: -1,
    atCommandStart: true,
  };
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
  return scan;
}

type Scan = {
  readonly command: string;
  readonly starts: Map<number, PathStartKind>;
  /** Every unquoted-context word, in order. */
  readonly words: Word[];
  readonly stack: Frame[];
  /** Index of the last backslash-escaped character, which is part of a word. */
  escaped: number;
  /** Whether the next word is the first word of a simple command. */
  atCommandStart: boolean;
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
    scan.stack.push({ kind: "`" });
    scan.atCommandStart = true;
  } else if (char === "$" && scan.command.charAt(i + 1) === "(") {
    scan.stack.push({ kind: "$(" });
    scan.atCommandStart = true;
    return i + 1;
  }
  return i;
}

/**
 * Record a word start for the command-word tracking `anchorDotPaths` uses. A
 * path start right after `=` continues the word before it.
 */
function recordWord({ scan, i }: { scan: Scan; i: number }): void {
  const { command } = scan;
  // Operators and blanks are not words, and a redirection target is not an
  // argument of the command.
  if (PLAIN_WORD_BOUNDARIES.has(command.charAt(i))) return;
  if (command.charAt(i - 1) === "=") return;
  let previous = i - 1;
  while (previous >= 0 && /\s/.test(command.charAt(previous))) previous--;
  if (previous >= 0 && "<>".includes(command.charAt(previous))) return;
  scan.words.push({ index: i, commandStart: scan.atCommandStart });
  scan.atCommandStart = false;
}

/** Whether the `&` at `i` is part of a redirection (`2>&1`, `&>`). */
function isRedirectionAmpersand({ command, i }: { command: string; i: number }): boolean {
  return "<>".includes(command.charAt(i - 1) || " ") || command.charAt(i + 1) === ">";
}

/** Unquoted: the top level, `$( … )`, `` ` … ` `` or `( … )`. */
function scanUnquoted({ scan, top, i }: { scan: Scan; top: Frame | undefined; i: number }): number {
  const { command, starts, stack } = scan;
  const char = command.charAt(i);
  const startsWord = followsBoundary({ scan, i });
  if (startsWord) {
    starts.set(i, "plain");
    recordWord({ scan, i });
  }
  if (COMMAND_SEPARATORS.has(char) && !(char === "&" && isRedirectionAmpersand({ command, i }))) {
    scan.atCommandStart = true;
    return i;
  }
  if (char === "#" && startsWord) {
    // A comment runs to the end of the line.
    const newline = command.indexOf("\n", i);
    return newline === -1 ? command.length : newline - 1;
  }
  if (char === '"') {
    stack.push({ kind: '"' });
    // A double-quoted `-c` script is expanded by the outer shell and then
    // re-split by the inner one, so an anchored path would not stay one word.
    if (startsWord && !isInnerShellScript({ command, i })) starts.set(i + 1, "double");
  } else if (char === "'") {
    if (isInnerShellScript({ command, i })) return scanInnerShellScript({ scan, i });
    stack.push({ kind: "'" });
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
  const inner = scanCommand(scan.command.slice(i + 1, end));
  for (const [index, kind] of inner.starts) {
    scan.starts.set(i + 1 + index, kind);
  }
  for (const { index, commandStart } of inner.words) {
    scan.words.push({ index: i + 1 + index, commandStart });
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
 * `-lc`, `-euc`), possibly after other options such as `-o pipefail`, `-O extglob` or
 * `--norc` and followed by `--`. Other commands' `-c` options (`git -c`,
 * `grep -c`, `head -c`) do not match.
 */
const INNER_SHELL_PATTERN =
  /(?:^|[\s;&|(`])(?:\S*\/)?(?:a|ba|da|k|mk|z)?sh(?:\s+(?:[-+][oO]\s+\w+|--?[A-Za-z][\w-]*|\+[A-Za-z]+))*\s+-[A-Za-z]*c[A-Za-z]*(?:\s+--)?\s*$/;

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
    if (top?.kind === "`") {
      stack.pop();
    } else {
      stack.push({ kind: "`" });
      scan.atCommandStart = true;
    }
  } else if (char === "$" && command.charAt(i + 1) === "(") {
    stack.push({ kind: "$(" });
    scan.atCommandStart = true;
    return i + 1;
  } else if (char === "(") {
    stack.push({ kind: "(" });
    scan.atCommandStart = true;
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
 * (`<<`), whose body is data rather than shell words, not with `eval`, which
 * would parse an expanded project path as shell code again, and not with a
 * command that runs its arguments in a container or on another host, where
 * the project path does not exist.
 */
function convertsLaterWords(command: string): boolean {
  return (
    !changesDirectory(command) &&
    !command.includes("<<") &&
    !containsCommand({ command, names: "eval|docker|podman|nerdctl|kubectl|ssh|vagrant" })
  );
}

/**
 * Commands that run the script named by their first non-option argument on
 * the same host, so that argument is a project file. `.` and `source` read it
 * into the current shell.
 */
const SCRIPT_RUNNERS = new Set([
  ".",
  "source",
  "sh",
  "ash",
  "bash",
  "dash",
  "ksh",
  "mksh",
  "zsh",
  "node",
  "python",
  "python3",
  "ruby",
  "perl",
  "php",
]);

/**
 * Words that may precede the command word of a simple command without being
 * it: reserved words and builtins that run the command that follows.
 */
const COMMAND_PREFIX_WORDS = new Set([
  "!",
  "{",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "time",
  "exec",
  "command",
  "builtin",
  "nohup",
]);

/** The unquoted text of the word at `index`, as far as a name needs it. */
function wordText({ command, index }: { command: string; index: number }): string {
  return (/^[^\s;&|()<>`]*/.exec(command.slice(index))?.[0] ?? "").replace(/["']/g, "");
}

/**
 * The `./` path starts `anchorDotPaths` rewrites: the command word of each
 * simple command when it is itself a `./` path, and the script argument of a
 * script runner (`node ./x.js`, `python3 "./my x.py"`, `. ./env.sh`). Other
 * arguments are data whose meaning depends on the command (`npx prettier
 * --write ./src`, `docker exec app ./x`), so they are left as written.
 */
function findPathsToAnchor({ command, scan }: { command: string; scan: Scan }): Set<number> {
  const pathAt = (index: number): number | undefined =>
    [index, index + 1].find((at) => scan.starts.has(at) && command.startsWith("./", at));
  const toAnchor = new Set<number>();
  let expecting: "command" | "script" | "none" = "command";
  for (const { index, commandStart } of scan.words) {
    if (commandStart) expecting = "command";
    const text = wordText({ command, index });
    if (expecting === "command") {
      if (COMMAND_PREFIX_WORDS.has(text) || /^\w+=/.test(text)) continue;
      const path = pathAt(index);
      if (path !== undefined) toAnchor.add(path);
      expecting = SCRIPT_RUNNERS.has(text.slice(text.lastIndexOf("/") + 1)) ? "script" : "none";
    } else if (expecting === "script" && !text.startsWith("-")) {
      const path = pathAt(index);
      // An unquoted `-c` script is re-split by the inner shell once expanded.
      if (path !== undefined && !isInnerShellScript({ command, i: index })) toAnchor.add(path);
      expecting = "none";
    }
  }
  return toAnchor;
}

/**
 * Anchor the `./` paths that name a file the command runs (see
 * `findPathsToAnchor`) with the project directory variable, the inverse of
 * `stripProjectDirVariable` at those positions:
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
  const scan = scanCommand(command);
  const toAnchor = findPathsToAnchor({ command, scan });
  const edits = [...scan.starts]
    .filter(([index]) => toAnchor.has(index))
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
 * portable `./` form, the inverse of `anchorDotPaths`. Import converts more
 * positions than generate anchors: a data argument such as
 * `npx prettier --write "$VAR"/src` becomes `./src` and is regenerated as
 * written, which is the same path for a hook that runs in the project root.
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
 * whose later words are not converted (see `convertsLaterWords`) or that
 * starts with another variable — every occurrence after the first word.
 */
export function stripProjectDirVariable({
  command,
  projectDirVar,
  firstWordOnly = false,
}: {
  command: string;
  projectDirVar: string;
  /** Convert only a variable that starts the command. */
  firstWordOnly?: boolean;
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
  const laterWords = !firstWordOnly && convertsLaterWords(command) && !startsWithOtherVariable;
  const starts = findPathStarts(command);

  return command.replace(pattern, (match: string, quote: string | undefined, offset: number) => {
    if (!laterWords && !inFirstWord(offset)) return match;
    const kind = starts.get(offset);
    if (kind !== "plain" && kind !== "double") return match;
    return `${quote ?? ""}./`;
  });
}
