import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Creates a unique test directory under /tmp/tests/
 * @returns Promise that resolves to the absolute path of the created directory
 */
export async function createTestDirectory(): Promise<string> {
  const testsDir = join(tmpdir(), "tests");

  // Ensure the tests directory exists
  try {
    await mkdir(testsDir, { recursive: true });
  } catch (error) {
    // Ignore error if directory already exists
    if (error instanceof Error && "code" in error && error.code !== "EEXIST") {
      throw error;
    }
  }

  const tempDir = await mkdtemp(join(testsDir, "rulesync-test-"));
  return tempDir;
}

/**
 * Removes a test directory and all its contents
 * @param testDir - The directory path to remove
 */
export async function cleanupTestDirectory(testDir: string): Promise<void> {
  await rm(testDir, { recursive: true, force: true });
}

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 */
export async function setupTestDirectory(): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testDir = await createTestDirectory();
  const cleanup = () => cleanupTestDirectory(testDir);
  return { testDir, cleanup };
}
