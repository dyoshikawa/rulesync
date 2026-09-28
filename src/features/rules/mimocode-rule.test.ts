import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { MimocodeRule } from "./mimocode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("MimocodeRule", () => {
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

  it("should resolve the root AGENTS.md and the .mimocode/memories dir", () => {
    const paths = MimocodeRule.getSettablePaths();
    expect(paths.root).toEqual({ relativeDirPath: ".", relativeFilePath: "AGENTS.md" });
    expect(paths.nonRoot?.relativeDirPath).toBe(join(".mimocode", "memories"));
    expect(MimocodeRule.getSettablePaths({ global: true }).root).toEqual({
      relativeDirPath: join(".config", "mimocode"),
      relativeFilePath: "AGENTS.md",
    });
  });

  it("should write non-root rules under .mimocode/memories", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "style.md",
      frontmatter: { root: false, targets: ["mimocode"] },
      body: "Use tabs.",
    });

    const rule = MimocodeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(rule).toBeInstanceOf(MimocodeRule);
    expect(rule.getRelativeDirPath()).toBe(join(".mimocode", "memories"));
  });

  it("should declare the shared mimocode config as an extra write path", () => {
    expect(MimocodeRule.getExtraSharedWritePaths()).toEqual([
      { relativeDirPath: ".mimocode", relativeFilePath: "mimocode.json" },
    ]);
  });
});
