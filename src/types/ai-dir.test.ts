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
  it("should use forward slashes only, even when relativeDirPath contains backslashes", () => {
    // Simulate Windows: relativeDirPath set from a platform-native path
    const dir = makeTestDir({
      relativeDirPath: ".rulesync\\skills",
      dirName: "my-skill",
    });
    expect(
      dir.getRelativePathFromCwd(),
      "getRelativePathFromCwd() must not contain backslashes",
    ).not.toContain("\\");
  });
});
