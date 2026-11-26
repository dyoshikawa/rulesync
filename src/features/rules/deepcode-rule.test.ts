import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DeepcodeRule } from "./deepcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("DeepcodeRule", () => {
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

  const makeRule = (
    frontmatter: ConstructorParameters<typeof RulesyncRule>[0]["frontmatter"],
    relativeFilePath = "overview.md",
  ) =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath,
      frontmatter,
      body: "Use the project conventions.",
    });

  it("should write project root rules to ./AGENTS.md", () => {
    const rule = DeepcodeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRule({ root: true, targets: ["deepcode"] }),
    });

    expect(rule.getRelativeDirPath()).toBe(".");
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(rule.getFileContent()).toBe("Use the project conventions.");
  });

  it("should write global root rules to .deepcode/AGENTS.md", () => {
    const rule = DeepcodeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRule({ root: true, targets: ["deepcode"] }),
      global: true,
    });

    expect(rule.getRelativeDirPath()).toBe(".deepcode");
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
  });

  it("should write a directory-scoped rule to a nested AGENTS.md", () => {
    const rule = DeepcodeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRule(
        { root: false, targets: ["deepcode"], agentsmd: { subprojectPath: "packages/app" } },
        "packages-app.md",
      ),
    });

    expect(rule.getRelativeDirPath()).toBe(join("packages", "app"));
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
  });

  it("should import the root AGENTS.md", async () => {
    await writeFileContent(join(testDir, "AGENTS.md"), "Root context.");

    const rule = await DeepcodeRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "AGENTS.md",
    });

    expect(rule.isRoot()).toBe(true);
    expect(rule.toRulesyncRule().getBody()).toBe("Root context.");
  });

  it("should only target deepcode or wildcard rules", () => {
    expect(DeepcodeRule.isTargetedByRulesyncRule(makeRule({ root: true, targets: ["*"] }))).toBe(
      true,
    );
    expect(
      DeepcodeRule.isTargetedByRulesyncRule(makeRule({ root: true, targets: ["deepcode"] })),
    ).toBe(true);
    expect(
      DeepcodeRule.isTargetedByRulesyncRule(makeRule({ root: true, targets: ["cursor"] })),
    ).toBe(false);
  });
});
