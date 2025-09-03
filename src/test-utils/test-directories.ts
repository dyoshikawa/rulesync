import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 *
 * This version uses direct Node.js APIs to avoid issues with mocked file utilities
 */
export async function setupTestDirectory(): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testsDir = join(tmpdir(), "tests");

  // Ensure the tests directory exists using direct Node.js API
  try {
    await mkdir(testsDir, { recursive: true });
  } catch {
    // Directory might already exist, ignore error
  }

  // Create temp directory using direct Node.js API
  const testDir = await mkdtemp(join(testsDir, "rulesync-test-"));

  const cleanup = async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { testDir, cleanup };
}

export * from "./logger-mock.js";
