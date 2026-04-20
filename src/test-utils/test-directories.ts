import crypto from "node:crypto";
import { join } from "node:path";

import { ensureDir, removeDirectory } from "../utils/file.js";

// Store the original cwd at module load time, before any mocks are applied
const originalCwd = process.cwd();

/**
 * Helper for test setup and cleanup
 * Returns an object with testDir path and cleanup function
 */
export async function setupTestDirectory({ home }: { home: boolean } = { home: false }): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  // Use TMPDIR environment variable to ensure writes are sandboxed-friendly
  const baseTmpDir = process.env.TMPDIR || join(originalCwd, "tmp", "tests");
  const testsDir = join(baseTmpDir, "rulesync-tests");
  const testDir = home
    ? join(testsDir, "home", randomString(16))
    : join(testsDir, "projects", randomString(16));
  await ensureDir(testDir);

  const cleanup = () => removeDirectory(testDir);
  return { testDir, cleanup };
}

function randomString(length: number) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}
