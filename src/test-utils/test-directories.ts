import { join } from "node:path";
import { ensureDir, removeDirectory } from "../utils/file.js";
import { getVitestWorkerId } from "../utils/vitest.js";

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
  const testsDir = join("./tmp", "tests");
  const testDir = global
    ? join(testsDir, "home", getVitestWorkerId())
    : join(testsDir, "projects", getVitestWorkerId());
  await ensureDir(testDir);

  const cleanup = () => removeDirectory(testDir);
  return { testDir, cleanup };
}
