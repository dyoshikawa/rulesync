import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { initCommand } from "../lib/init-command.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { executeInit } from "./init.js";

// `init` writes relative to the real working directory, which a mocked
// `process.cwd()` does not move, so the command is mocked here; its own
// behavior is covered by `src/lib/init-command.test.ts`.
vi.mock("../lib/init-command.js");

describe("executeInit", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.mocked(initCommand).mockReset();
  });

  it("runs init with a JSON-mode logger and returns what it captured", async () => {
    vi.mocked(initCommand).mockImplementation(async (logger) => {
      expect(logger.jsonMode).toBe(true);
      logger.captureData("created", ["rulesync.jsonc"]);
      logger.captureData("skipped", []);
      logger.success("rulesync initialized successfully!");
    });

    const result = await executeInit();

    expect(result).toEqual({
      success: true,
      message: "rulesync initialized successfully!",
      result: { created: ["rulesync.jsonc"], skipped: [] },
    });
  });

  it("returns the error when init fails", async () => {
    vi.mocked(initCommand).mockRejectedValue(new Error("EACCES"));

    const result = await executeInit();

    expect(result.success).toBe(false);
    expect(result.error).toContain("EACCES");
  });

  it("refuses to run when a destination is a dangling link out of the project", async () => {
    const outside = await setupTestDirectory();
    try {
      await symlink(
        join(outside.testDir, "new-file"),
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      );

      const result = await executeInit();

      expect(result.success).toBe(false);
      expect(result.error).toContain("must stay inside the project directory");
      expect(initCommand).not.toHaveBeenCalled();
    } finally {
      await outside.cleanup();
    }
  });
});
