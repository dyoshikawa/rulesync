import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { executeGitignore } from "./gitignore.js";

describe("executeGitignore", () => {
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

  it("writes entries for the requested targets and reports them", async () => {
    const result = await executeGitignore({ targets: ["claudecode"], features: ["rules"] });

    expect(result.success).toBe(true);
    const entriesAdded = result.result?.entriesAdded as string[];
    expect(entriesAdded.length).toBeGreaterThan(0);
    expect(result.result?.gitignorePath).toBe(join(testDir, ".gitignore"));
    const content = await readFileContent(join(testDir, ".gitignore"));
    for (const entry of entriesAdded) {
      expect(content).toContain(entry);
    }
  });

  it("reports an up-to-date run", async () => {
    await executeGitignore({ targets: ["claudecode"] });
    const result = await executeGitignore({ targets: ["claudecode"] });

    expect(result.success).toBe(true);
    expect(result.result?.entriesAdded).toEqual([]);
    expect(result.message).toContain("already up to date");
  });

  it.each([".gitignore", ".gitattributes"])(
    "refuses to write through %s linked outside the project",
    async (fileName) => {
      const outside = await setupTestDirectory();
      try {
        const outsideFile = join(outside.testDir, "victim");
        await writeFileContent(outsideFile, "original\n");
        await symlink(outsideFile, join(testDir, fileName));

        const result = await executeGitignore({ targets: ["claudecode"] });

        expect(result.success).toBe(false);
        expect(result.error).toContain("symbolic link");
        expect(await readFileContent(outsideFile)).toBe("original\n");
      } finally {
        await outside.cleanup();
      }
    },
  );

  it("refuses a dangling link out of the project", async () => {
    const outside = await setupTestDirectory();
    try {
      await symlink(join(outside.testDir, "new-file"), join(testDir, ".gitattributes"));

      const result = await executeGitignore({ targets: ["claudecode"] });

      expect(result.success).toBe(false);
      expect(result.error).toContain("symbolic link");
    } finally {
      await outside.cleanup();
    }
  });
});
