import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTempDirectory, ensureDir, removeDirectory } from "../utils/file.js";

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
  await ensureDir(testsDir);

  const testDir = await createTempDirectory(join(testsDir, "rulesync-test-"));
  const cleanup = () => removeDirectory(testDir);
  return { testDir, cleanup };
}

export * from "./logger-mock.js";
