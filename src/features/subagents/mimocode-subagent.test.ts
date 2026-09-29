import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { MimocodeSubagent } from "./mimocode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("MimocodeSubagent", () => {
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

  it("should resolve project and global settable paths under the mimocode dirs", () => {
    expect(MimocodeSubagent.getSettablePaths().relativeDirPath).toBe(join(".mimocode", "agents"));
    expect(MimocodeSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "mimocode", "agents"),
    );
  });

  it("should read the mimocode section and round-trip it on import", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "docs-writer.md",
      frontmatter: {
        targets: ["mimocode"],
        name: "docs-writer",
        description: "Writes documentation",
        mimocode: { model: "model-x" },
        opencode: { model: "ignored" },
      },
      body: "Document the APIs",
      validate: false,
    });

    const subagent = MimocodeSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as MimocodeSubagent;

    expect(subagent).toBeInstanceOf(MimocodeSubagent);
    expect(subagent.getFrontmatter()).toMatchObject({ model: "model-x", mode: "subagent" });
    expect(subagent.toRulesyncSubagent().getFrontmatter()).toMatchObject({
      mimocode: { model: "model-x", mode: "subagent" },
    });
  });
});
