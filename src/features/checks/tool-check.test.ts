import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  ToolCheckFromFileParams,
  ToolCheckFromRulesyncCheckParams,
} from "./tool-check.js";

// Test implementation of ToolCheck for exercising the abstract class behavior.
class TestToolCheck extends ToolCheck {
  static async fromFile(params: ToolCheckFromFileParams): Promise<TestToolCheck> {
    const { outputRoot = process.cwd(), relativeFilePath } = params;
    return new TestToolCheck({
      outputRoot,
      relativeDirPath: ".test",
      relativeFilePath,
      fileContent: "test tool check content",
    });
  }

  static fromRulesyncCheck(params: ToolCheckFromRulesyncCheckParams): TestToolCheck {
    const { rulesyncCheck, outputRoot = process.cwd() } = params;
    return new TestToolCheck({
      outputRoot,
      relativeDirPath: ".test",
      relativeFilePath: "test-tool.md",
      fileContent: rulesyncCheck.getBody(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCheck(): RulesyncCheck {
    return new RulesyncCheck({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: "converted.md",
      frontmatter: { targets: ["*"] },
      body: "Converted content",
      validate: false,
    });
  }
}

describe("ToolCheck", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should throw when calling unimplemented static methods on the base class", async () => {
    expect(() => ToolCheck.getSettablePaths()).toThrow(
      "Please implement this method in the subclass.",
    );
    await expect(ToolCheck.fromFile({ relativeFilePath: "x.md" })).rejects.toThrow(
      "Please implement this method in the subclass.",
    );
    expect(() =>
      ToolCheck.forDeletion({ relativeDirPath: ".test", relativeFilePath: "x.md" }),
    ).toThrow("Please implement this method in the subclass.");
  });

  it("should inherit ToolFile/AiFile functionality in a concrete subclass", () => {
    const toolCheck = new TestToolCheck({
      outputRoot: testDir,
      relativeDirPath: ".test",
      relativeFilePath: "test.md",
      fileContent: "content",
    });

    expect(toolCheck).toBeInstanceOf(ToolCheck);
    expect(toolCheck.getRelativeDirPath()).toBe(".test");
    expect(toolCheck.getRelativeFilePath()).toBe("test.md");
    expect(toolCheck.toRulesyncCheck()).toBeInstanceOf(RulesyncCheck);
  });
});
