import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderSubagent } from "./qoder-subagent.js";
import { QodercnSubagent } from "./qodercn-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("QodercnSubagent", () => {
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

  const makeRulesyncSubagent = (targets: string[]) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: {
        targets,
        name: "reviewer",
        description: "Review code",
        qoder: { tools: "Read,Grep" },
      } as never,
      body: "You are a reviewer.",
    });

  it("should share .qoder/agents in project scope and use ~/.qoder-cn/agents globally", () => {
    expect(QodercnSubagent.getSettablePaths().relativeDirPath).toBe(join(".qoder", "agents"));
    expect(QodercnSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder-cn", "agents"),
    );
    expect(QoderSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "agents"),
    );
  });

  it("should write the qoder section into a ~/.qoder-cn/agents file", () => {
    const subagent = QodercnSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent: makeRulesyncSubagent(["qodercn"]),
      global: true,
    });

    expect(subagent).toBeInstanceOf(QodercnSubagent);
    expect(subagent.getRelativeDirPath()).toBe(join(".qoder-cn", "agents"));
    expect(subagent.getFileContent()).toContain("tools: Read,Grep");
  });

  it("should be targeted by qodercn only", () => {
    expect(QodercnSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent(["qodercn"]))).toBe(
      true,
    );
    expect(QodercnSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent(["qoder"]))).toBe(
      false,
    );
    expect(QoderSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent(["qodercn"]))).toBe(
      false,
    );
  });
});
