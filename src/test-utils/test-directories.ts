import crypto from "node:crypto";
import { join } from "node:path";
import { ensureDir, removeDirectory } from "../utils/file.js";
import { getVitestWorkerId } from "../utils/vitest.js";

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 */
export async function setupTestDirectory({ home }: { home: boolean } = { home: false }): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testsDir = join("./tmp", "tests");
  const testDir = home
    ? join(testsDir, "home", getVitestWorkerId())
    : join(testsDir, "projects", randomString(16));
  await ensureDir(testDir);

  const cleanup = () => removeDirectory(testDir);
  return { testDir, cleanup };
}

function randomString(length: number) {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
}
