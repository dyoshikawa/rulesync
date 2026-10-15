import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { TraeIgnore } from "./trae-ignore.js";

describe("TraeIgnore", () => {
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

  it("targets .trae/.ignore", () => {
    expect(TraeIgnore.getSettablePaths()).toEqual({
      relativeDirPath: ".trae",
      relativeFilePath: ".ignore",
    });
  });

  it("writes the rulesync ignore patterns verbatim", () => {
    const rulesyncIgnore = new RulesyncIgnore({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: "# build output\ndist/\n*.log\nsrc/generated/**",
    });

    const ignore = TraeIgnore.fromRulesyncIgnore({ outputRoot: testDir, rulesyncIgnore });

    expect(ignore.getFilePath()).toBe(join(testDir, ".trae", ".ignore"));
    expect(ignore.getFileContent()).toBe("# build output\ndist/\n*.log\nsrc/generated/**");
  });

  it("imports an existing .trae/.ignore", async () => {
    await ensureDir(join(testDir, ".trae"));
    await writeFileContent(join(testDir, ".trae", ".ignore"), "node_modules\ncoverage\n");

    const ignore = await TraeIgnore.fromFile({ outputRoot: testDir });

    expect(ignore.toRulesyncIgnore().getFileContent()).toBe("node_modules\ncoverage\n");
  });
});
