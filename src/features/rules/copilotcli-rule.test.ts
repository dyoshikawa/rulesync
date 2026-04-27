import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CopilotRule } from "./copilot-rule.js";
import { CopilotcliRule } from "./copilotcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CopilotcliRule", () => {
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

  describe("fromRulesyncRule", () => {
    it("should pass validate to the copied Copilot rule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["copilotcli"],
        },
        body: "Test rule content",
      });

      const invalidCopilotRule = Reflect.construct(CopilotRule, [
        {
          outputRoot: testDir,
          relativeDirPath: ".github/instructions",
          relativeFilePath: "test.instructions.md",
          frontmatter: {
            excludeAgent: "invalid-agent",
          },
          body: "Test rule content",
          validate: false,
        },
      ]);
      const fromRulesyncRuleSpy = vi
        .spyOn(CopilotRule, "fromRulesyncRule")
        .mockReturnValue(invalidCopilotRule);

      expect(() =>
        CopilotcliRule.fromRulesyncRule({ rulesyncRule, validate: false }),
      ).not.toThrow();
      expect(fromRulesyncRuleSpy).toHaveBeenCalledWith({
        rulesyncRule,
        validate: false,
      });

      expect(() => CopilotcliRule.fromRulesyncRule({ rulesyncRule, validate: true })).toThrow(
        "Invalid frontmatter",
      );
    });
  });
});
