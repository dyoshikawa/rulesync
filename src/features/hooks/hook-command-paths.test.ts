import { describe, expect, it } from "vitest";

import {
  anchorDotPaths,
  changesDirectory,
  findPathStarts,
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
    ["x >./o.txt 2>./e.log", `x >"${VAR}"/o.txt 2>"${VAR}"/e.log`],
    ["tool --config=./c.json", `tool --config="${VAR}"/c.json`],
    ["echo `./v.sh`", `echo \`"${VAR}"/v.sh\``],
    ['echo "$(./v.sh)"', `echo "$("${VAR}"/v.sh)"`],
    ["bash -c 'test -x ./k.sh'", `bash -c 'test -x "${VAR}"/k.sh'`],
    ["a && ./b.sh", `a && "${VAR}"/b.sh`],
    ["bash -lc './a && ./b'", `bash -lc '"${VAR}"/a && "${VAR}"/b'`],
    ["/bin/sh -euc './a'", `/bin/sh -euc '"${VAR}"/a'`],
    ["bash -o pipefail -c './a | ./b'", `bash -o pipefail -c '"${VAR}"/a | "${VAR}"/b'`],
    ["bash --norc -c './a'", `bash --norc -c '"${VAR}"/a'`],
    ["bash -c -- './a'", `bash -c -- '"${VAR}"/a'`],
    ["mksh -c './a'", `mksh -c '"${VAR}"/a'`],
    // The inner shell reads its own double quotes.
    [`bash -c 'x "./y"'`, `bash -c 'x "${VAR}/y"'`],
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
    [`$HOME/x`, "$HOME/x"],
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
  ])("should leave %s untouched", (command) => {
    expect(strip(command)).toBe(command);
  });

  it("should only convert the first word of a command that changes directory", () => {
    expect(strip(`"${VAR}/a.sh" && cd sub && ${VAR}/b.sh`)).toBe(
      `"./a.sh" && cd sub && ${VAR}/b.sh`,
    );
  });

  it.each([
    `x >"${VAR}"/o.txt`,
    `x 2>${VAR}/log`,
    `echo \`${VAR}/x\``,
    `node "${VAR}"/'b c.js'`,
    `python3 "${VAR}/my dir/x.py" --flag`,
    `bash -c 'test -x ${VAR}/k.sh'`,
    `bash -lc '${VAR}/a && ${VAR}/b'`,
    `bash -c 'x "${VAR}/y"'`,
    `bash -c 'echo "a ${VAR}/x"'`,
    `git -c 'core.hooksPath=${VAR}/hooks' status`,
    `sh -c "${VAR}/x"`,
    `x <<< ${VAR}/y`,
    `echo "$(${VAR}/v.sh)"`,
    `x ${VAR}/a/${VAR}/b`,
    `PATH=$PATH:${VAR}/bin x`,
  ])("should keep %s anchored through strip and anchor, and stable on re-import", (command) => {
    const canonical = strip(command);
    const regenerated = anchor(canonical);
    expect(strip(regenerated)).toBe(canonical);
    // Every variable reference import removed is restored by generate.
    const count = (value: string): number => value.split(VAR).length - 1;
    expect(count(regenerated)).toBe(count(command));
  });
});
