import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { AiFile, type ValidationResult } from "./ai-file.js";

class TestAiFile extends AiFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

describe("AiFile.withOutputRoot", () => {
  it("should return a copy written under the new output root with the other fields kept", () => {
    const file = new TestAiFile({
      outputRoot: "/sub",
      relativeDirPath: ".rulesync",
      relativeFilePath: ".aiignore",
      fileContent: "secret/",
    });

    const rebased = file.withOutputRoot("/project");

    expect(rebased).toBeInstanceOf(TestAiFile);
    expect(rebased.getFilePath()).toBe(join("/project", ".rulesync", ".aiignore"));
    expect(rebased.getFileContent()).toBe("secret/");
    expect(file.getFilePath()).toBe(join("/sub", ".rulesync", ".aiignore"));
  });

  it("should return the same instance when the output root does not change", () => {
    const file = new TestAiFile({
      outputRoot: "/project",
      relativeDirPath: ".rulesync",
      relativeFilePath: ".aiignore",
      fileContent: "",
    });

    expect(file.withOutputRoot("/project")).toBe(file);
  });
});
