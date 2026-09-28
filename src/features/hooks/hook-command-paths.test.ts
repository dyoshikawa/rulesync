import { describe, expect, it } from "vitest";

import {
  anchorDotPaths,
  changesDirectory,
  findPathStarts,
  importProjectDirVariable,
  stripProjectDirVariable,
} from "./hook-command-paths.js";

const VAR = "$CLAUDE_PROJECT_DIR";
const strip = (command: string): string => stripProjectDirVariable({ command, projectDirVar: VAR });
const anchor = (command: string): string => anchorDotPaths({ command, projectDirVar: VAR });

describe("findPathStarts", () => {
  it("should classify word starts by how the shell reads them", () => {
    const command = `a "b" 'c' bash -c 'd e' # f`;
    const starts = findPathStarts(command);
    expect(starts.get(command.indexOf("a"))).toBe("plain");
    expect(starts.get(command.indexOf("b"))).toBe("double");
    expect(starts.get(command.indexOf("c'"))).toBe("single");
    expect(starts.get(command.indexOf("d"))).toBe("plain");
    expect(starts.get(command.indexOf("e'"))).toBe("plain");
    expect(starts.has(command.indexOf("f"))).toBe(false);
  });

  it("should not treat an escaped character or a mid-word position as a start", () => {
    const command = "a\\ ./b c/./d";
    const starts = findPathStarts(command);
    expect(starts.has(command.indexOf("./b"))).toBe(false);
    expect(starts.has(command.indexOf("./d"))).toBe(false);
  });
});

describe("changesDirectory", () => {
  it.each([
    "cd sub && ./x",
    "pushd sub; ./x; popd",
    "bash -c 'cd sub && ./run.sh'",
    'sh -c "cd sub; ./x"',
    "(cd sub && ./x)",
    "{ cd sub; ./x; }",
    '"cd" sub && ./x',
    "\\cd sub && ./x",
    "(cd) && ./x",
    "x; cd; ./y",
    "cd&&./x",
    "builtin cd sub; ./x",
  ])("should detect %s", (command) => {
    expect(changesDirectory(command)).toBe(true);
  });

  it.each(["./cdx.sh", "abcd ./x", "echo cd-rom", "cdk deploy ./x"])(
    "should not detect %s",
    (command) => {
      expect(changesDirectory(command)).toBe(false);
    },
  );
});

describe("anchorDotPaths", () => {
  it.each([
    ["node ./x.js", `node "${VAR}"/x.js`],
    ['python3 "./my dir/x.py"', `python3 "${VAR}/my dir/x.py"`],
    ["node './my dir/x.js'", `node "${VAR}"/'my dir/x.js'`],
    ["/usr/bin/python3 ./x.py ./data", `/usr/bin/python3 "${VAR}"/x.py ./data`],
    ["node -r ./reg.js", `node -r "${VAR}"/reg.js`],
    ["node ./x.js > ./o.txt", `node "${VAR}"/x.js > ./o.txt`],
    [". ./env.sh && run", `. "${VAR}"/env.sh && run`],
    ["FOO=1 node ./x.js 2>&1 | ./tee.sh", `FOO=1 node "${VAR}"/x.js 2>&1 | "${VAR}"/tee.sh`],
    ["if ./a; then ./b; fi", `if "${VAR}"/a; then "${VAR}"/b; fi`],
    ["echo `./v.sh`", `echo \`"${VAR}"/v.sh\``],
    ['echo "$(./v.sh)"', `echo "$("${VAR}"/v.sh)"`],
    ["bash -c 'test -x ./k.sh && ./k.sh'", `bash -c 'test -x ./k.sh && "${VAR}"/k.sh'`],
    ["a && ./b.sh", `a && "${VAR}"/b.sh`],
    ["bash -lc './a && ./b'", `bash -lc '"${VAR}"/a && "${VAR}"/b'`],
    ["/bin/sh -euc './a'", `/bin/sh -euc '"${VAR}"/a'`],
    ["bash -o pipefail -c './a | ./b'", `bash -o pipefail -c '"${VAR}"/a | "${VAR}"/b'`],
    ["bash --norc -c './a'", `bash --norc -c '"${VAR}"/a'`],
    ["bash -c -- './a'", `bash -c -- '"${VAR}"/a'`],
    ["mksh -c './a'", `mksh -c '"${VAR}"/a'`],
    // The inner shell reads its own double quotes.
    [`bash -c 'node "./y"'`, `bash -c 'node "${VAR}/y"'`],
    ["bash -O extglob -c './a'", `bash -O extglob -c '"${VAR}"/a'`],
    ["bash -o pipefail ./a.sh", `bash -o pipefail "${VAR}"/a.sh`],
    // Runners named by version or path, and runners of runners.
    ["python3.12 ./x.py", `python3.12 "${VAR}"/x.py`],
    ["bun ./x.ts", `bun "${VAR}"/x.ts`],
    ["bun run ./x.ts", `bun run "${VAR}"/x.ts`],
    ["deno run -A ./x.ts", `deno run -A "${VAR}"/x.ts`],
    ["uv run ./x.py ./data", `uv run "${VAR}"/x.py ./data`],
    ["uv run --with requests ./x.py", `uv run --with requests "${VAR}"/x.py`],
    ["uv run python -W ignore ./x.py", `uv run python -W ignore "${VAR}"/x.py`],
    ["npx tsx ./x.ts ./data", `npx tsx "${VAR}"/x.ts ./data`],
    ["npx --yes ts-node ./x.ts", `npx --yes ts-node "${VAR}"/x.ts`],
    ["pnpm exec tsx ./x.ts", `pnpm exec tsx "${VAR}"/x.ts`],
    // An option value is not the script; a file it loads is anchored.
    ["node -r ./r.js ./a.js", `node -r "${VAR}"/r.js "${VAR}"/a.js`],
    ["python3 -W ignore ./x.py", `python3 -W ignore "${VAR}"/x.py`],
    ["npx -p tsx tsx ./x.ts", `npx -p tsx tsx "${VAR}"/x.ts`],
    ["time bash -c './a'", `time bash -c '"${VAR}"/a'`],
    ["uv run sh -c './a'", `uv run sh -c '"${VAR}"/a'`],
    ["perl -I ./lib ./x.pl", `perl -I "${VAR}"/lib "${VAR}"/x.pl`],
    ["php -d display_errors=1 ./x.php", `php -d display_errors=1 "${VAR}"/x.php`],
    // Options of a prefix word come before the command word.
    ["time -p node ./x.js", `time -p node "${VAR}"/x.js`],
    ["exec -a name ./x.sh", `exec -a name "${VAR}"/x.sh`],
    // `env` runs the command after its assignments.
    ["env FOO=1 ./x.sh", `env FOO=1 "${VAR}"/x.sh`],
    ["env FOO=1 BAR=2 node ./x.js", `env FOO=1 BAR=2 node "${VAR}"/x.js`],
    // An escaped command name still runs that command.
    ["\\node ./x.js", `\\node "${VAR}"/x.js`],
    // A quote on the next line is a new command, not a `-c` script.
    ["x # sh -c\n'./a.sh'", `x # sh -c\n"${VAR}"/'a.sh'`],
    ["echo sh -c\n'./a.sh'", `echo sh -c\n"${VAR}"/'a.sh'`],
    // An escaped or quoted shell name still runs its `-c` script.
    ["\\bash -c './x y'", `\\bash -c '"${VAR}"/x y'`],
    [`"bash" -c './x y'`, `"bash" -c '"${VAR}"/x y'`],
    // A line continuation joins the lines.
    ["bash \\\n -c './x y'", `bash \\\n -c '"${VAR}"/x y'`],
    ["node \\\n./x.js", `node \\\n"${VAR}"/x.js`],
    ["bash -c \\\n'./x y'", `bash -c \\\n'"${VAR}"/x y'`],
    ["no\\\nde ./y.js", `no\\\nde "${VAR}"/y.js`],
    ["node >\\\n./log ./x.js", `node >\\\n./log "${VAR}"/x.js`],
    ["node --import=\\\n./r.js ./x.js", `node --import=\\\n./r.js "${VAR}"/x.js`],
    [`'bash' -c './x y'`, `'bash' -c '"${VAR}"/x y'`],
    // A redirection is not the script argument.
    ["node 2>/dev/null ./x.js", `node 2>/dev/null "${VAR}"/x.js`],
    ["python3 2>&1 ./x.py", `python3 2>&1 "${VAR}"/x.py`],
    ["exec -la name ./x.sh", `exec -la name "${VAR}"/x.sh`],
    ["php -c ./php.ini ./x.php", `php -c "${VAR}"/php.ini "${VAR}"/x.php`],
    ["bash --rcfile ./rc ./x.sh", `bash --rcfile "${VAR}"/rc "${VAR}"/x.sh`],
  ])("should anchor %s", (command, expected) => {
    expect(anchor(command)).toBe(expected);
  });

  it.each([
    // Not an explicit `./` at a word start.
    "cat ../shared/notes.txt",
    "git add .gitignore",
    "ls a/./b",
    "PATH=$PATH:./bin x",
    // Text inside a quoted string, not a path word.
    "sed -i 's|./dist|out|' f",
    "grep -r 'a ./node_modules' .",
    'echo "done; ./x"',
    // A comment.
    "x # it's ./y",
    // After a change of directory `./` is no longer the project root.
    "./build.sh && cd dist && ./post.sh",
    "bash -c 'cd sub && ./run.sh'",
    // `-c` of a command other than a shell takes a literal value.
    "git -c 'core.hooksPath=./hooks' status",
    "grep -c 'a ./x' f",
    "cut -c '1 ./x'",
    // A double-quoted `-c` script is re-split by the inner shell.
    'sh -c "./x && ./y"',
    'bash --norc -c "./x"',
    // Text inside a quoted string of an inner shell script.
    `bash -c 'echo "a ./x"'`,
    `bash -c 'true; sh -c "echo; ./x"'`,
    // `eval` would parse an expanded project path as code again.
    'eval "./x"',
    "eval ./x",
    // An ANSI-C string is a literal.
    "echo $'a\\' ./x'",
    // A heredoc or here-string body is data, not shell words.
    "cat <<EOF > f\n./x\nEOF",
    "x <<< ./y",
    // Data arguments, whose meaning depends on the command.
    "x >./o.txt 2>./e.log",
    "tool --config=./c.json",
    "npx prettier --write ./src",
    "uv run pytest ./tests",
    "uv pip install ./pkg",
    "pnpm run lint ./src",
    "bun run build ./src",
    // Paths handed to a container or another host.
    "docker compose exec -T app ./vendor/bin/pint",
    "docker run img sh -c './x'",
    "ssh host ./deploy.sh",
    "kubectl exec pod -- ./x",
    // An unquoted `-c` script is re-split by the inner shell once expanded.
    "sh -c ./x.sh",
    // A `-c` script handed to another command runs elsewhere, if at all.
    "sudo sh -c 'node ./x.js'",
    "env -i sh -c './x.sh'",
    // `env` options are not followed: `-u` takes a value, `-C` changes directory.
    "env -u NAME ./x.sh",
    "env -C sub ./x.sh",
    "find . -execdir sh -c './fix.sh' \\;",
    "echo bash -c './x'",
    "\\sudo sh -c './x.sh'",
    "\\echo sh -c './x.sh'",
    // To a runner other than a shell, a quoted script is a literal argument.
    "node -r sh -c './x'",
    "\\bash -c ./x",
    // `--rcfile` takes `-c` as its value, so the quote is part of a file name.
    "bash --rcfile -c './x'",
    "bash --init-file -c './x'",
    // A package runner's shell mode re-parses its command line.
    "npx -c './x.sh --flag'",
    "npx --call ./x.sh",
    "npm exec -c ./x.sh",
    "pnpm exec --shell-mode ./x.sh",
    "pnpm -c exec ./x.sh",
    "yarn exec ./x.sh",
    // Without a blank, a continuation joins `bash` and `-c` into one word.
    "bash\\\n-c './x y'",
    "node\\\nx ./y.js",
    "FOO=\\\n./x",
    // Joined by a line continuation, the next line continues the word.
    "ab\\\ncd ./x",
    // The positional parameters of a `-c` script are data.
    "bash -c 'exec node' ./x.js",
    // Inline code, a module or standard input instead of a script file.
    "python3 -c './x' ./y",
    "python3 -m pkg ./y",
    "node -e './x' ./y",
    "bash -s ./x",
  ])("should leave %s untouched", (command) => {
    expect(anchor(command)).toBe(command);
  });
});

describe("stripProjectDirVariable", () => {
  it.each([
    [`python3 "${VAR}/x.py"`, 'python3 "./x.py"'],
    [`node "${VAR}"/'b c.js'`, "node './b c.js'"],
    [`x >"${VAR}"/o.txt`, "x >./o.txt"],
    [`x 2>${VAR}/log`, "x 2>./log"],
    [`echo \`${VAR}/x\``, "echo `./x`"],
    // A quote after the variable that closes a `-c` script stays after `./`.
    [`bash -c 'node "${VAR}"/'\\''x y.js'\\'''`, "bash -c 'node ./'\\''x y.js'\\'''"],
    [`\\bash -c 'node "${VAR}"/x.js'`, "\\bash -c 'node ./x.js'"],
    [`node \\\n"${VAR}"/x.js`, "node \\\n./x.js"],
    [`$HOME/x`, "$HOME/x"],
    [`"$HOME"/x && ${VAR}/y`, `"$HOME"/x && ${VAR}/y`],
  ])("should convert %s", (command, expected) => {
    expect(strip(command)).toBe(expected);
  });

  it.each([
    // Not a path start: generate could not restore the variable there.
    `PATH=$PATH:${VAR}/bin x`,
    `x "a:${VAR}/y"`,
    `x {${VAR}/a,b}`,
    // A literal single-quoted string is never expanded by the shell.
    `grep '${VAR}/x' f`,
    // A comment.
    `x # ${VAR}/y`,
    // A command led by another variable is passed through by generate.
    `$HOME/x "${VAR}"/y`,
    // `-c` of a command other than a shell takes a literal value.
    `git -c 'core.hooksPath=${VAR}/hooks' status`,
    `grep -c '${VAR}/x' f`,
    // A double-quoted `-c` script: generate does not anchor there either.
    `sh -c "${VAR}/x"`,
    // A heredoc or here-string body is data, not shell words.
    `cat <<EOF > f\n${VAR}/x\nEOF`,
    `x <<< ${VAR}/y`,
    `bash -c 'echo "a ${VAR}/x"'`,
    `eval "${VAR}/x"`,
    // A `-c` script the command does not run itself.
    `find . -execdir sh -c '${VAR}/x' \\;`,
    `sudo sh -c 'node ${VAR}/x.js'`,
    `\\sudo sh -c 'node ${VAR}/x.js'`,
    `node -r sh -c '${VAR}/x'`,
  ])("should leave %s untouched", (command) => {
    expect(strip(command)).toBe(command);
  });

  it("should only convert the first word of a command that changes directory", () => {
    expect(strip(`"${VAR}/a.sh" && cd sub && ${VAR}/b.sh`)).toBe(
      `"./a.sh" && cd sub && ${VAR}/b.sh`,
    );
  });

  it.each([
    [`PATH=${VAR}/bin:$PATH ./x`, `PATH=${VAR}/bin:$PATH ./x`],
    [`node ./x.js --config=${VAR}/c.json`, `node ./x.js --config=${VAR}/c.json`],
    [`node ./x.js --config="${VAR}/c.json"`, `node ./x.js --config="${VAR}/c.json"`],
    [`node ./x.js --config="${VAR}"/c.json`, `node ./x.js --config="${VAR}"/c.json`],
    [`${VAR}/a.sh --config=${VAR}/c.json`, `./a.sh --config=${VAR}/c.json`],
  ])(
    "should keep the variable in the value of an assignment or option: %s",
    (command, expected) => {
      expect(importProjectDirVariable({ command, projectDirVar: VAR })).toEqual({
        command: expected,
        unrestored: false,
        retained: true,
      });
    },
  );

  it.each([
    [`${VAR}/a.sh`, false, false],
    [`node ${VAR}/x.js`, false, false],
    [`'${VAR}/x'`, false, false],
    [`${VAR}/a.sh && cd sub && ${VAR}/b.sh`, false, true],
    [`${VAR}/a.ps1 --config ${VAR}/c.json`, true, true],
    [`${VAR}/a.ps1`, true, false],
  ])(
    "should report whether %s keeps a variable (first word only: %s): %s",
    (command, firstWordOnly, expected) => {
      expect(
        importProjectDirVariable({ command, projectDirVar: VAR, firstWordOnly }).retained,
      ).toBe(expected);
    },
  );

  const count = (value: string): number => value.split(VAR).length - 1;

  it.each([
    [`node ${VAR}/x.js`, false],
    [`node -r ${VAR}/r.js ${VAR}/a.js`, false],
    [`${VAR}/a.sh; cd sub; ${VAR}/b.sh`, false],
    [`npx prettier --write ${VAR}/src`, true],
    // A new anchor elsewhere does not make up for a lost one.
    [`node ./a.js "${VAR}"/data`, true],
  ])("should report whether generate restores every variable of %s: %s", (command, expected) => {
    expect(importProjectDirVariable({ command, projectDirVar: VAR }).unrestored).toBe(expected);
  });

  it.each([
    `node "${VAR}"/'b c.js'`,
    `python3 "${VAR}/my dir/x.py" --flag`,
    `${VAR}/a.sh && node ${VAR}/b.js`,
    `echo \`${VAR}/x\``,
    `echo "$(${VAR}/v.sh)"`,
    `bash -lc '${VAR}/a && ${VAR}/b'`,
    `bash -c 'node "${VAR}/y"'`,
    `bash -c 'node "${VAR}"/'\\''x y.js'\\'''`,
    `sh -c "${VAR}/x"`,
    `git -c 'core.hooksPath=${VAR}/hooks' status`,
    `bash -c 'echo "a ${VAR}/x"'`,
    `x <<< ${VAR}/y`,
    `PATH=$PATH:${VAR}/bin x`,
    `uv run "${VAR}/x.py"`,
    `bun ${VAR}/x.ts`,
    `npx tsx "${VAR}"/x.ts`,
    `python3.12 "${VAR}"/x.py`,
    `node -r "${VAR}"/r.js "${VAR}"/a.js`,
    `python3 -W ignore "${VAR}"/x.py`,
    `uv run --with requests "${VAR}"/x.py`,
  ])("should restore every variable in %s through strip and anchor", (command) => {
    const canonical = strip(command);
    const regenerated = anchor(canonical);
    expect(strip(regenerated)).toBe(canonical);
    expect(count(regenerated)).toBe(count(command));
  });

  it.each([
    `x >"${VAR}"/o.txt`,
    `x 2>${VAR}/log`,
    `bash -c 'test -x ${VAR}/k.sh'`,
    `x ${VAR}/a/${VAR}/b`,
    `npx prettier --write "${VAR}"/src`,
  ])("should leave data arguments of %s cwd-relative and stable on re-import", (command) => {
    const canonical = strip(command);
    const regenerated = anchor(canonical);
    expect(regenerated).toBe(canonical);
    expect(strip(regenerated)).toBe(canonical);
  });
});
