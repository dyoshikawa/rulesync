import { describe, expect, it } from "vitest";

import { AiDir, AiDirParams, ValidationResult } from "./ai-dir.js";

class TestAiDir extends AiDir {
  validate(): ValidationResult {
    return { success: true, error: undefined };
  }
}

function makeTestDir(
  params: Omit<AiDirParams, "relativeDirPath" | "dirName"> & {
    relativeDirPath: string;
    dirName: string;
  },
): TestAiDir {
  return new TestAiDir(params);
}

describe("AiDir.getRelativePathFromCwd - cross-platform path separator", () => {
  it.each([
    ["Windows style input", ".rulesync\\skills", "my-skill", ".rulesync/skills/my-skill"],
    ["POSIX style input", ".rulesync/skills", "my-skill", ".rulesync/skills/my-skill"],
  ])("should format to POSIX paths consistently (%s)", (_, relativeDirPath, dirName, expected) => {
    const dir = makeTestDir({
      relativeDirPath,
      dirName,
    });
    const result = dir.getRelativePathFromCwd();
    expect(result).toBe(expected);
    expect(result, "getRelativePathFromCwd() must not contain backslashes").not.toContain("\\");
  });
});

describe("AiDir constructor - dirName validation", () => {
  it.each([
    ["path separator", "nested/skill"],
    ["Windows separator", "nested\\skill"],
  ])("should reject a dirName containing a %s", (_, dirName) => {
    expect(() => makeTestDir({ relativeDirPath: ".agents/skills", dirName })).toThrow(
      "cannot contain path separators",
    );
  });

  it.each([
    ["empty", ""],
    ["current directory", "."],
    ["parent directory", ".."],
  ])("should reject a %s dirName", (_, dirName) => {
    // `path.join` normalizes these away, so the directory collapses onto its
    // parent root without escaping outputRoot — the traversal guard in
    // getDirPath() never fires. Tools that derive dirName from a skill's
    // frontmatter `name` make this attacker-influenced input.
    expect(() => makeTestDir({ relativeDirPath: ".agents/skills", dirName })).toThrow(
      'cannot be empty, ".", or ".."',
    );
  });

  it("should accept a dirName that merely starts with a dot", () => {
    expect(() =>
      makeTestDir({ relativeDirPath: ".agents/skills", dirName: ".hidden-skill" }),
    ).not.toThrow();
  });
});
