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
    [
      "Windows style input", 
      ".rulesync\\skills", 
      "my-skill", 
      ".rulesync/skills/my-skill"
    ],
    [
      "POSIX style input", 
      ".rulesync/skills", 
      "my-skill", 
      ".rulesync/skills/my-skill"
    ],
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
