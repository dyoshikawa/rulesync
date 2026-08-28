import { join } from "node:path";

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

describe("AiDir.ownsDirTree", () => {
  it("should own its tree when getDirPath() ends with dirName", () => {
    const dir = makeTestDir({ relativeDirPath: ".agents/skills", dirName: "my-skill" });
    expect(dir.ownsDirTree()).toBe(true);
  });

  it("should not own a tree when a subclass flattens into a shared root", () => {
    // `TaktSkill` does exactly this: it drops `dirName` so every skill lands as a
    // flat file in one root. Claiming that root as a tree would exempt every
    // sibling in it from the `--delete` orphan sweep.
    class FlattenedAiDir extends TestAiDir {
      override getDirPath(): string {
        return join(this.getOutputRoot(), this.getRelativeDirPath());
      }
    }

    const dir = new FlattenedAiDir({
      relativeDirPath: ".takt/facets/knowledge",
      dirName: "my-skill",
    });
    expect(dir.ownsDirTree()).toBe(false);
  });
});

describe("AiDir.getFlatFilePath", () => {
  /** A subclass that flattens into a shared root, the way `TaktSkill` does. */
  class FlattenedAiDir extends TestAiDir {
    override getDirPath(): string {
      return join(this.getOutputRoot(), this.getRelativeDirPath());
    }
  }

  function makeFlattenedDir(params: { mainFileName?: string }): FlattenedAiDir {
    const { mainFileName } = params;
    return new FlattenedAiDir({
      outputRoot: "/repo",
      relativeDirPath: ".takt/facets/knowledge",
      dirName: "my-skill",
      mainFile:
        mainFileName === undefined ? undefined : { name: mainFileName, body: "", frontmatter: {} },
    });
  }

  it("should name the file the entry flattens into", () => {
    expect(makeFlattenedDir({ mainFileName: "my-skill.md" }).getFlatFilePath()).toBe(
      join("/repo", ".takt/facets/knowledge", "my-skill.md"),
    );
  });

  it("should name no file for an entry that owns its directory", () => {
    // Its tree is what stands for it, and the directory half of the orphan
    // sweep is what removes that.
    const dir = makeTestDir({
      outputRoot: "/repo",
      relativeDirPath: ".agents/skills",
      dirName: "my-skill",
      mainFile: { name: "SKILL.md", body: "", frontmatter: {} },
    });
    expect(dir.getFlatFilePath()).toBeUndefined();
  });

  it("should name no file for an entry that carries none", () => {
    expect(makeFlattenedDir({}).getFlatFilePath()).toBeUndefined();
  });

  it.each([
    ["path separator", "nested/skill.md"],
    ["Windows separator", "nested\\skill.md"],
    ["parent directory", ".."],
    ["current directory", "."],
    ["empty name", ""],
  ])("should name no file for a main file named with a %s", (_label, mainFileName) => {
    // Each of these lands somewhere other than directly under the shared
    // root — on the root itself, for `"."` — and the sweep may only remove a
    // file that sits in it.
    expect(makeFlattenedDir({ mainFileName }).getFlatFilePath()).toBeUndefined();
  });
});
