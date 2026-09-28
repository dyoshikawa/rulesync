import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuffIgnore } from "./codebuff-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("CodebuffIgnore", () => {
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

  it("targets .codebuffignore at the project root", () => {
    expect(CodebuffIgnore.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: ".codebuffignore",
    });
  });

  it("writes the rulesync ignore patterns verbatim", () => {
    const rulesyncIgnore = new RulesyncIgnore({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: "# build output\ndist/\n*.log\nsrc/generated/**",
    });

    const ignore = CodebuffIgnore.fromRulesyncIgnore({ outputRoot: testDir, rulesyncIgnore });

    expect(ignore.getFilePath()).toBe(join(testDir, ".codebuffignore"));
    expect(ignore.getFileContent()).toBe("# build output\ndist/\n*.log\nsrc/generated/**");
  });

  it("imports an existing .codebuffignore", async () => {
    await writeFileContent(join(testDir, ".codebuffignore"), "node_modules\ncoverage\n");

    const ignore = await CodebuffIgnore.fromFile({ outputRoot: testDir });

    expect(ignore.toRulesyncIgnore().getFileContent()).toBe("node_modules\ncoverage\n");
  });
});
