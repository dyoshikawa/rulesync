import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 */
export async function setupTestDirectory(): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testsDir = join(tmpdir(), "tests");

  // Ensure the tests directory exists
  try {
    await mkdir(testsDir, { recursive: true });
  } catch (error) {
    // Ignore error if directory already exists
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code !== "EEXIST"
    ) {
      throw error;
    }
  }

  const testDir = await mkdtemp(join(testsDir, "rulesync-test-"));
  const cleanup = () => rm(testDir, { recursive: true, force: true });
  return { testDir, cleanup };
}

export * from "./logger-mock.js";
export * from "./mock-config.js";
