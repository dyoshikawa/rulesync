import { lookupOwn } from "../../utils/own-lookup.js";

/**
 * Shell-aware helpers for anchoring `./` paths in hook commands to a tool's
 * project directory variable (e.g. `$CLAUDE_PROJECT_DIR`) and for stripping
 * that variable back off on import.
 *
 * Both directions share one shell scanner. Generate anchors only the `./`
 * paths a command runs as files; import normalizes the variable wherever it
 * starts a path and reports the ones generate would not restore. A second
 * import of a regenerated command is stable.
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

/** The name of a POSIX-like shell, as a regular expression source. */
const SHELL_NAME = "(?:a|ba|da|k|mk|z)?sh";

/** Matches the basename of a POSIX-like shell. */
const SHELL_NAME_PATTERN = new RegExp(`^${SHELL_NAME}$`);

/** Matches a shell option cluster that contains `c` (`-c`, `-lc`, `-euc`). */
const SHELL_CODE_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/;

/** Escape a string for literal use in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Characters after which an unquoted shell word can start. */
const PLAIN_WORD_BOUNDARIES = new Set([" ", "\t", "\n", ";", "&", "|", "(", "<", ">", "=", "`"]);

/** Characters that end one simple command and start the next. */
const COMMAND_SEPARATORS = new Set([";", "&", "|", "\n"]);

type Frame = { readonly kind: '"' | "'" | "$(" | "(" | "`" };

/**
 * A shell word, whether it is the first word of a simple command, and — for a
 * word of a single-quoted `-c` script — the index of that script's opening
 * quote, which is recorded as a word of the outer command first.
 */
type Word = { readonly index: number; readonly commandStart: boolean; readonly script?: number };

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
    scripts: [],
    escaped: -1,
    atCommandStart: true,
  };
  for (let i = 0; i < command.length; i++) {
    const top = scan.stack.at(-1);
    if (top?.kind === "'") {
      if (command.charAt(i) === "'") scan.stack.pop();
    } else if (command.charAt(i) === "\\") {
      i = scanEscape({ scan, top, i });
    } else if (top?.kind === '"') {
      i = scanDoubleQuoted({ scan, i });
    } else {
      i = scanUnquoted({ scan, top, i });
    }
  }
  return scan;
}

/**
 * An escaped character is a literal and never starts a path, but a word may
 * begin with one: `\\sudo` still runs `sudo`. A line continuation (`\\` before
 * a newline) is removed by the shell, so it is skipped as if it were not there
 * (see `previousIndex`). Returns the index of the escaped character.
 */
function scanEscape({ scan, top, i }: { scan: Scan; top: Frame | undefined; i: number }): number {
  if (scan.command.charAt(i + 1) === "\n") return i + 1;
  if (top?.kind !== '"' && followsBoundary({ scan, i })) recordWord({ scan, i });
  scan.escaped = i + 1;
  return i + 1;
}

/** The index of the character before `i`, skipping line continuations. */
function previousIndex({ command, i }: { command: string; i: number }): number {
  let previous = i - 1;
  while (
    previous >= 1 &&
    command.charAt(previous) === "\n" &&
    command.charAt(previous - 1) === "\\"
  ) {
    previous -= 2;
  }
  return previous;
}

type Scan = {
  readonly command: string;
  readonly starts: Map<number, PathStartKind>;
  /** Every unquoted-context word, in order. */
  readonly words: Word[];
  /** The single-quoted `-c` scripts: opening quote and closing quote. */
  readonly scripts: Array<{ readonly index: number; readonly end: number }>;
  readonly stack: Frame[];
  /** Index of the last backslash-escaped character, which is part of a word. */
  escaped: number;
  /** Whether the next word is the first word of a simple command. */
  atCommandStart: boolean;
};

function followsBoundary({ scan, i }: { scan: Scan; i: number }): boolean {
  const previous = previousIndex({ command: scan.command, i });
  return (
    previous < 0 ||
    (PLAIN_WORD_BOUNDARIES.has(scan.command.charAt(previous)) && scan.escaped !== previous)
  );
}

/** A file descriptor number that starts a redirection (`2>`, `3>&1`). */
const FD_REDIRECTION = /\d+[<>]/y;

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
  // Operators and blanks are not words, and neither a redirection nor its
  // target is an argument of the command.
  if (PLAIN_WORD_BOUNDARIES.has(command.charAt(i))) return;
  FD_REDIRECTION.lastIndex = i;
  if (FD_REDIRECTION.test(command)) return;
  let previous = previousIndex({ command, i });
  if (command.charAt(previous) === "=") return;
  while (previous >= 0 && /\s/.test(command.charAt(previous))) {
    previous = previousIndex({ command, i: previous });
  }
  if (previous >= 0 && "<>".includes(command.charAt(previous))) return;
  // The target of a descriptor duplication (`2>&1`, `<&0`).
  if (command.charAt(previous) === "&" && "<>".includes(command.charAt(previous - 1))) return;
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
    scan.words.push({ index: i + 1 + index, commandStart, script: i });
  }
  scan.scripts.push({ index: i, end });
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
 * `grep -c`, `head -c`) do not match. The shell name may be escaped or quoted
 * (`\\bash`, `"bash"`). The words must be on one line, or joined by line
 * continuations: a newline ends the command, so a quote on the next line is
 * not its script.
 */
const INNER_SHELL_PATTERN = (() => {
  // Blanks, possibly with line continuations; at least one blank separates
  // two words, since a bare continuation joins them.
  const gap = String.raw`(?:[ \t]|\\\n)`;
  const separator = String.raw`(?:\\\n)*[ \t]${gap}*`;
  return new RegExp(
    String.raw`(?:^|[\s;&|(${"`"}])\\?["']?(?:[^\s;&|()<>'"${"`"}]*\/)?${SHELL_NAME}["']?` +
      String.raw`(?:${separator}(?:[-+][oO]${separator}\w+|--?[A-Za-z][\w-]*|\+[A-Za-z]+))*` +
      String.raw`${separator}${SHELL_CODE_OPTION.source.slice(1, -1)}(?:${separator}--)?${gap}*$`,
  );
})();

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
  return DIRECTORY_CHANGE_PATTERN.test(command);
}

/** Matches one of the `|`-separated command names as a word. */
function commandPattern(names: string): RegExp {
  return new RegExp(`(?:^|[\\s;&|(){\`'"])\\\\?(?:${names})(?:[\\s;&|()\`'"]|$)`);
}

const DIRECTORY_CHANGE_PATTERN = commandPattern("cd|pushd|popd");

const ELSEWHERE_PATTERN = commandPattern("eval|docker|podman|nerdctl|kubectl|ssh|vagrant");

/**
 * Whether `./` words after the first one are converted in both directions:
 * not after a directory change, not in a command with a heredoc or here-string
 * (`<<`), whose body is data rather than shell words, not with `eval`, which
 * would parse an expanded project path as shell code again, and not with a
 * command that runs its arguments in a container or on another host, where
 * the project path does not exist.
 */
function convertsLaterWords(command: string): boolean {
  return !changesDirectory(command) && !command.includes("<<") && !ELSEWHERE_PATTERN.test(command);
}

/**
 * Commands that run the script named by their first non-option argument on
 * the same host, so that argument is a project file. `.` and `source` read it
 * into the current shell. Matched against the basename, so `/usr/bin/python3`
 * and `python3.12` count too.
 */
const SCRIPT_RUNNER_PATTERN = new RegExp(
  String.raw`^(?:\.|source|${SHELL_NAME}|node|nodejs|bun|tsx|ts-node|python(?:\d+(?:\.\d+)?)?|ruby|perl|php)$`,
);

/**
 * Tools whose subcommand runs the command that follows it on the same host:
 * `uv run ./x.py`, `deno run -A ./x.ts`, `pnpm exec tsx ./x.ts`. The word
 * after the subcommand and its options is read as a command word.
 */
const RUN_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  uv: new Set(["run"]),
  bun: new Set(["run", "x"]),
  deno: new Set(["run"]),
  npm: new Set(["exec"]),
  pnpm: new Set(["exec", "dlx"]),
  yarn: new Set(["exec", "dlx"]),
  poetry: new Set(["run"]),
  pipenv: new Set(["run"]),
};

/**
 * Package runners whose first non-option argument is the command they run:
 * `npx tsx ./x.ts` runs `tsx`, whose own script argument is then anchored,
 * while `npx prettier --write ./src` leaves the data argument alone.
 */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx"]);

const NODE_VALUE_OPTIONS = ["-r", "--require", "--import", "--loader", "--experimental-loader"];
const PACKAGE_VALUE_OPTIONS = ["-p", "--package"];

/**
 * Options that take the next word as their value, per command, so the value
 * is not mistaken for the script (`python3 -W ignore ./x.py`). A `./` value
 * names a file the command loads (`node -r ./register.js ./x.js`) and is
 * anchored as well. An option written as `--name=value` is a single word and
 * needs no entry.
 */
const VALUE_OPTIONS: Record<string, ReadonlySet<string>> = {
  node: new Set(NODE_VALUE_OPTIONS),
  nodejs: new Set(NODE_VALUE_OPTIONS),
  tsx: new Set(NODE_VALUE_OPTIONS),
  "ts-node": new Set([...NODE_VALUE_OPTIONS, "-P", "--project"]),
  bun: new Set(["-r", "--preload", "--config"]),
  deno: new Set(["-c", "--config", "--import-map"]),
  python: new Set(["-W", "-X"]),
  ruby: new Set(["-r", "-I"]),
  perl: new Set(["-I"]),
  php: new Set(["-c", "-d"]),
  uv: new Set(["--with", "--with-requirements", "--python", "-p", "--env-file"]),
  npx: new Set(PACKAGE_VALUE_OPTIONS),
  bunx: new Set(PACKAGE_VALUE_OPTIONS),
  pnpx: new Set(PACKAGE_VALUE_OPTIONS),
  pnpm: new Set(PACKAGE_VALUE_OPTIONS),
  yarn: new Set(PACKAGE_VALUE_OPTIONS),
  npm: new Set(PACKAGE_VALUE_OPTIONS),
  sh: new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]),
};

const NODE_CODE_OPTIONS = ["-e", "--eval", "-p", "--print"];

/**
 * Options after which a runner runs no script file: the code or module named
 * next (`python3 -c '…'`, `python3 -m pkg`, `node -e '…'`) or standard input
 * (`bash -s`). The words after them are data. A shell's `-c` script is read as
 * a command of its own instead (see `scanInnerShellScript`).
 */
const CODE_OPTIONS: Record<string, ReadonlySet<string>> = {
  node: new Set(NODE_CODE_OPTIONS),
  nodejs: new Set(NODE_CODE_OPTIONS),
  tsx: new Set(NODE_CODE_OPTIONS),
  "ts-node": new Set(NODE_CODE_OPTIONS),
  bun: new Set(NODE_CODE_OPTIONS),
  deno: new Set(["eval"]),
  python: new Set(["-c", "-m"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e", "-E"]),
  php: new Set(["-r"]),
  sh: new Set(["-s"]),
};

/** The per-command option table entry for a runner named `name`. */
function optionsFor({
  table,
  name,
}: {
  table: Record<string, ReadonlySet<string>>;
  name: string;
}): ReadonlySet<string> | undefined {
  if (name.startsWith("python")) return table.python;
  if (SHELL_NAME_PATTERN.test(name)) return table.sh;
  return lookupOwn({ record: table, key: name });
}

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

/** Longest word prefix `wordText` reads. */
const WORD_TEXT_LIMIT = 256;

/**
 * The unquoted text of the word at `index`, as far as a name needs it, with
 * line continuations joined.
 */
function wordText({ command, index }: { command: string; index: number }): string {
  // A name is short, so a bounded slice is enough and keeps the walk linear.
  const text = command.slice(index, index + WORD_TEXT_LIMIT).replaceAll("\\\n", "");
  return (/^[^\s;&|()<>`]*/.exec(text)?.[0] ?? "").replace(/["'\\]/g, "");
}

/**
 * What the next word of a simple command is expected to be:
 *
 * - `command`: the command word (after prefix words and assignments);
 * - `wrapped`: the command word of a command run by a package runner or a
 *   run subcommand, after that runner's options;
 * - `subcommand`: the subcommand of a tool listed in `RUN_SUBCOMMANDS`;
 * - `script`: the script argument of a script runner, after its options;
 * - `none`: data arguments, which are never anchored.
 */
type Expecting = "command" | "wrapped" | "subcommand" | "script" | "none";

/** The positions a command runs as files, and the `-c` scripts it runs. */
type CommandPaths = {
  /** The `./` path starts that name a file the command runs. */
  readonly toAnchor: Set<number>;
  /**
   * The opening quotes of the single-quoted `-c` scripts that a shell run by
   * the command reads, as opposed to text that only looks like one, such as
   * `sudo sh -c '…'` or `echo sh -c '…'`.
   */
  readonly runScripts: Set<number>;
};

/**
 * Walk the words of a command and find the `./` path starts `anchorDotPaths`
 * rewrites: the command word of each simple command when it is itself a `./`
 * path, the script argument of a script runner (`node ./x.js`,
 * `python3 "./my x.py"`, `. ./env.sh`), also behind a package runner or run
 * subcommand (`npx tsx ./x.ts`, `uv run ./x.py`), and the value of a runner
 * option that loads a file (`node -r ./register.js`). Other arguments are data
 * whose meaning depends on the command (`npx prettier --write ./src`,
 * `docker exec app ./x`), so they are left as written.
 *
 * A single-quoted `-c` script is followed only when it is the script argument
 * of a shell the command runs itself; under another command (`sudo`, `find
 * -execdir`, `echo`) it runs elsewhere, if at all.
 */
function findCommandPaths({ command, scan }: { command: string; scan: Scan }): CommandPaths {
  // A word may open with a quote; the quote opening a `-c` script is not one,
  // since the path after it belongs to the script.
  const scriptQuotes = new Set(scan.scripts.map(({ index }) => index));
  const pathAt = (index: number): number | undefined =>
    (scriptQuotes.has(index) ? [index] : [index, index + 1]).find(
      (at) => scan.starts.has(at) && command.startsWith("./", at),
    );
  const toAnchor = new Set<number>();
  const runScripts = new Set<number>();
  const state: WalkState = {
    expecting: "command",
    owner: "",
    optionValue: false,
    previousScript: undefined,
    prefix: undefined,
    prefixValue: false,
    shellCode: false,
  };
  for (const word of scan.words) {
    if (!startWord({ state, word, runScripts })) continue;
    const text = wordText({ command, index: word.index });
    const path = pathAt(word.index);
    if (state.optionValue) {
      // The value of a runner option: anchored when it names a file.
      state.optionValue = false;
      if (path !== undefined) toAnchor.add(path);
    } else if (state.expecting === "command" && consumePrefixWord({ state, text })) {
      continue;
    } else if (state.expecting !== "command" && /^[-+]/.test(text)) {
      readOption({ state, text });
    } else if (
      state.expecting === "subcommand" &&
      lookupOwn({ record: RUN_SUBCOMMANDS, key: state.owner })?.has(text)
    ) {
      state.expecting = "wrapped";
    } else if (state.expecting === "script" || state.expecting === "subcommand") {
      // A tool that is a script runner itself takes the script without a
      // subcommand (`bun ./x.ts`); any other tool's subcommand runs nothing.
      if (state.expecting === "script" || SCRIPT_RUNNER_PATTERN.test(state.owner)) {
        readScript({
          state,
          index: word.index,
          opensScript: scriptQuotes.has(word.index),
          path,
          toAnchor,
          runScripts,
        });
      }
      state.expecting = "none";
    } else {
      // A command word, possibly behind a runner.
      if (path !== undefined) toAnchor.add(path);
      state.owner = text.slice(text.lastIndexOf("/") + 1);
      state.expecting = afterCommandWord(state.owner);
      state.prefix = undefined;
      state.shellCode = false;
    }
  }
  return { toAnchor, runScripts };
}

/** Where `findCommandPaths` is in the current simple command. */
type WalkState = {
  expecting: Expecting;
  /** The command whose options are being read. */
  owner: string;
  /** Whether the next word is the value of one of those options. */
  optionValue: boolean;
  /** The `-c` script the previous word belonged to. */
  previousScript: number | undefined;
  /** The last prefix word before the command word, whose options are skipped. */
  prefix: string | undefined;
  /** Whether the next word is the value of a prefix word's option. */
  prefixValue: boolean;
  /** Whether a shell was given `-c`, so its script argument is code. */
  shellCode: boolean;
};

/**
 * Update the walk for the next word, and tell whether that word is read at
 * all: not when it belongs to a `-c` script the command does not run, nor
 * when it is a data argument.
 */
function startWord({
  state,
  word,
  runScripts,
}: {
  state: WalkState;
  word: Word;
  runScripts: ReadonlySet<number>;
}): boolean {
  const { commandStart, script } = word;
  if (script !== undefined && !runScripts.has(script)) return false;
  // The words after a `-c` script are its positional parameters.
  const leftScript = state.previousScript !== undefined && script === undefined;
  state.previousScript = script;
  if (commandStart) {
    state.expecting = "command";
    state.optionValue = false;
    state.prefix = undefined;
    state.prefixValue = false;
    state.shellCode = false;
  } else if (leftScript) {
    state.expecting = "none";
  }
  return state.expecting !== "none";
}

/**
 * Whether a word before the command word leaves it still to come: a prefix
 * word, an assignment, or an option of a prefix word (`time -p`), consuming
 * the value of `exec -a name` as well.
 */
function consumePrefixWord({ state, text }: { state: WalkState; text: string }): boolean {
  if (state.prefixValue) {
    state.prefixValue = false;
    return true;
  }
  if (COMMAND_PREFIX_WORDS.has(text)) {
    state.prefix = text;
    return true;
  }
  if (state.prefix !== undefined && text.startsWith("-")) {
    state.prefixValue = state.prefix === "exec" && /^-[A-Za-z]*a$/.test(text);
    return true;
  }
  return /^\w+=/.test(text);
}

/** Read an option of the runner whose options are being read. */
function readOption({ state, text }: { state: WalkState; text: string }): void {
  if (optionsFor({ table: CODE_OPTIONS, name: state.owner })?.has(text)) state.expecting = "none";
  state.optionValue = optionsFor({ table: VALUE_OPTIONS, name: state.owner })?.has(text) ?? false;
  if (SHELL_NAME_PATTERN.test(state.owner) && SHELL_CODE_OPTION.test(text)) {
    state.shellCode = true;
  }
}

/** What follows a command word whose basename is `name`. */
function afterCommandWord(name: string): Expecting {
  if (Object.hasOwn(RUN_SUBCOMMANDS, name)) return "subcommand";
  if (PACKAGE_RUNNERS.has(name)) return "wrapped";
  return SCRIPT_RUNNER_PATTERN.test(name) ? "script" : "none";
}

/**
 * Read the script argument of a script runner. A shell given `-c` reads it as
 * code: a single-quoted script found by the scanner is followed, and any other
 * form (unquoted, double-quoted) is left alone, since the inner shell would
 * split an expanded path again. A quote the scanner took for a `-c` script is
 * a literal to any other runner, and to a shell that got no `-c` (`bash
 * --rcfile -c './x'`), so it is not anchored either.
 */
function readScript({
  state,
  index,
  opensScript,
  path,
  toAnchor,
  runScripts,
}: {
  state: WalkState;
  index: number;
  opensScript: boolean;
  path: number | undefined;
  toAnchor: Set<number>;
  runScripts: Set<number>;
}): void {
  // Only a shell owner sets `shellCode`, and a new command word resets it.
  if (state.shellCode) {
    if (opensScript) runScripts.add(index);
  } else if (!opensScript && path !== undefined) {
    toAnchor.add(path);
  }
}

/**
 * Anchor the `./` paths that name a file the command runs (see
 * `findCommandPaths`) with the project directory variable, the inverse of
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
  const { toAnchor } = findCommandPaths({ command, scan });
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
 * portable `./` form, the inverse of `anchorDotPaths` (see
 * `importProjectDirVariable`, which also reports what generate cannot
 * restore).
 */
export function stripProjectDirVariable(options: {
  command: string;
  projectDirVar: string;
  firstWordOnly?: boolean;
}): string {
  return importProjectDirVariable(options).command;
}

/**
 * Rewrite references to the project directory variable in a command to the
 * portable `./` form, and tell whether generate restores each of them.
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
 * Import converts more positions than generate anchors: a data argument such
 * as `npx prettier --write "$VAR"/src` becomes `./src` and is regenerated as
 * written, so it is then resolved against the hook's working directory, which
 * need not be the project root (a worktree, or the target of an earlier `cd`).
 * `unrestored` is true when the command has such a path, so the caller can
 * report it.
 *
 * Left untouched: an escaped `\$VAR`, a longer name such as `$VAR_2`, a bare
 * `$VAR` not followed by `/`, a variable that does not start a path (`a:$VAR/x`),
 * one inside a literal single-quoted string, a comment, or a `-c` script the
 * command does not run itself (`sudo sh -c '…'`), and — in a command whose
 * later words are not converted (see `convertsLaterWords`) or that starts
 * with another variable — every occurrence after the first word.
 */
export function importProjectDirVariable({
  command,
  projectDirVar,
  firstWordOnly = false,
}: {
  command: string;
  projectDirVar: string;
  /** Convert only a variable that starts the command. */
  firstWordOnly?: boolean;
}): { command: string; unrestored: boolean } {
  const escapedName = escapeRegExp(projectDirVar.replace(/^\$/, ""));
  const variable = `\\$(?:${escapedName}|\\{${escapedName}\\})`;
  const pattern = new RegExp(`(?:"${variable}"/(["']?)|${variable}/)`, "g");

  const leading = command.length - command.trimStart().length;
  // The first word may open with a quote: `"$VAR/x.sh"`.
  const inFirstWord = (offset: number): boolean =>
    offset === leading || (offset === leading + 1 && command.charAt(leading) === '"');
  // The first word may be quoted: `"$HOME"/x` starts with another variable too.
  const firstWord = command.slice(leading).replace(/^["']/, "");
  const startsWithOtherVariable =
    firstWord.startsWith("$") && !new RegExp(`^${variable}"?/`).test(firstWord);
  const laterWords = !firstWordOnly && convertsLaterWords(command) && !startsWithOtherVariable;
  const scan = scanCommand(command);
  const { runScripts } = findCommandPaths({ command, scan });
  // The bodies of the `-c` scripts that the command does not run itself.
  const idleScripts = scan.scripts.filter(({ index }) => !runScripts.has(index));
  const inIdleScript = (offset: number): boolean =>
    idleScripts.some(({ index, end }) => offset > index && offset < end);
  // The quote after `"$VAR"/` is moved in front of `./` only when it opens a
  // quoted path; one that closes a `-c` script stays after it
  // (`sh -c 'node "$VAR"/'\''x y.js'\'''` becomes `sh -c 'node ./'\''x y.js'\'''`).
  const scriptEnds = new Set(scan.scripts.map(({ end }) => end));

  // Where each converted later `./` starts in the result.
  const converted: number[] = [];
  let shift = 0;
  const result = command.replace(
    pattern,
    (match: string, quote: string | undefined, offset: number) => {
      const firstWordMatch = inFirstWord(offset);
      if (!laterWords && !firstWordMatch) return match;
      const kind = scan.starts.get(offset);
      if ((kind !== "plain" && kind !== "double") || inIdleScript(offset)) return match;
      const moved = quote && !scriptEnds.has(offset + match.length - 1) ? quote : "";
      const replacement = `${moved}./${quote?.slice(moved.length) ?? ""}`;
      if (!firstWordMatch) converted.push(offset + shift + moved.length);
      shift += replacement.length - match.length;
      return replacement;
    },
  );

  // The first word is always restored by generate's own prefix.
  const { toAnchor } =
    converted.length > 0
      ? findCommandPaths({ command: result, scan: scanCommand(result) })
      : { toAnchor: new Set<number>() };
  return { command: result, unrestored: converted.some((at) => !toAnchor.has(at)) };
}
