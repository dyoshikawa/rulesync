// eslint-disable-next-line strict-dependencies/strict-dependencies
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTempDirectory, ensureDir, removeDirectory } from "../utils/file.js";

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 */
export async function setupTestDirectory(
  { global = false }: { global?: boolean } = { global: false },
): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testsDir = join(tmpdir(), "tests");

  // Ensure the tests directory exists
  await ensureDir(testsDir);

  const testDir = global
    ? join(testsDir, "home", getVitestWorkerId())
    : join(testsDir, "project", getVitestWorkerId());
  await ensureDir(testDir);

  const cleanup = () => removeDirectory(testDir);
  return { testDir, cleanup };
}

function getVitestWorkerId(): string {
  const vitestWorkerId = process.env.VITEST_WORKER_ID;
  if (!vitestWorkerId) {
    throw new Error("VITEST_WORKER_ID is not set");
  }
  return vitestWorkerId;
}

export * from "./logger-mock.js";
