import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "./file.js";
import {
  resolveRulesyncSourceWritePath,
  type RulesyncSourceSettablePaths,
} from "./rulesync-source-path.js";

const paths = {
  recommended: {
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.jsonc",
  },
  legacy: [
    {
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
    },
  ],
} satisfies RulesyncSourceSettablePaths;

describe("resolveRulesyncSourceWritePath", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let outputRoot: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    outputRoot = join(testDir, "project");
    await ensureDir(join(outputRoot, ".rulesync"));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should prefer the recommended source when both variants exist", async () => {
    await writeFileContent(join(outputRoot, ".rulesync", "mcp.jsonc"), "{}");
    await writeFileContent(join(outputRoot, ".rulesync", "mcp.json"), "{}");

    await expect(resolveRulesyncSourceWritePath({ outputRoot, paths })).resolves.toEqual(
      paths.recommended,
    );
  });

  it("should select an existing legacy source", async () => {
    await writeFileContent(join(outputRoot, ".rulesync", "mcp.json"), "{}");

    await expect(resolveRulesyncSourceWritePath({ outputRoot, paths })).resolves.toEqual(
      paths.legacy[0],
    );
  });

  describe.skipIf(process.platform === "win32")("symbolic links", () => {
    it("should reject an existing source that is a symbolic link", async () => {
      const outsidePath = join(testDir, "outside.jsonc");
      await writeFileContent(outsidePath, "{}");
      await symlink(outsidePath, join(outputRoot, ".rulesync", "mcp.jsonc"));

      await expect(resolveRulesyncSourceWritePath({ outputRoot, paths })).rejects.toThrow(
        "Refusing to write through a symbolic link",
      );
    });

    it("should reject a symbolic link in the recommended source path", async () => {
      const outsideDir = join(testDir, "outside");
      const linkedOutputRoot = join(testDir, "linked-project");
      await ensureDir(outsideDir);
      await ensureDir(linkedOutputRoot);
      await symlink(outsideDir, join(linkedOutputRoot, ".rulesync"));

      await expect(
        resolveRulesyncSourceWritePath({ outputRoot: linkedOutputRoot, paths }),
      ).rejects.toThrow("Refusing to write through a symbolic link");
    });
  });
});
