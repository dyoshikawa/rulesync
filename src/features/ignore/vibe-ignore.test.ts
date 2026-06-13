import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { VibeIgnore } from "./vibe-ignore.js";

describe("VibeIgnore", () => {
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

  it("should map rulesync ignore content to .vibeignore", () => {
    const rulesyncIgnore = new RulesyncIgnore({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".aiignore",
      fileContent: "node_modules\n.env\n",
    });

    const vibeIgnore = VibeIgnore.fromRulesyncIgnore({ outputRoot: testDir, rulesyncIgnore });

    expect(vibeIgnore.getRelativeDirPath()).toBe(".");
    expect(vibeIgnore.getRelativeFilePath()).toBe(".vibeignore");
    expect(vibeIgnore.getFileContent()).toBe("node_modules\n.env\n");
  });

  it("should import .vibeignore as rulesync ignore", async () => {
    await writeFileContent(join(testDir, ".vibeignore"), "dist\n.cache\n");

    const vibeIgnore = await VibeIgnore.fromFile({ outputRoot: testDir });
    const rulesyncIgnore = vibeIgnore.toRulesyncIgnore();

    expect(vibeIgnore.getPatterns()).toEqual(["dist", ".cache"]);
    expect(rulesyncIgnore.getFileContent()).toBe("dist\n.cache\n");
  });
});
