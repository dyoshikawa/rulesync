import { execFile } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";

// Save original working directory
const originalCwd = process.cwd();

export const execFileAsync = promisify(execFile);

// Get the command to run from environment variable
// Default to using tsx directly with the CLI entry point
const tsxPath = join(originalCwd, "node_modules", ".bin", "tsx");
const cliPath = join(originalCwd, "src", "cli", "index.ts");

// Validate process.env.RULESYNC_CMD
if (process.env.RULESYNC_CMD) {
  const resolvedRulesyncCmd = resolve(process.env.RULESYNC_CMD);
  const splittedResolvedRulesyncCmd = resolvedRulesyncCmd.split(sep);
  const valid =
    splittedResolvedRulesyncCmd.at(-2) === "dist-bun" &&
    splittedResolvedRulesyncCmd.at(-1)?.startsWith("rulesync-");
  if (!valid) {
    throw new Error(
      `Invalid RULESYNC_CMD: must start with 'dist-bun' directory and end with 'rulesync-<platform>-<arch>': ${process.env.RULESYNC_CMD}`,
    );
  }
}

// Convert relative path to absolute path if RULESYNC_CMD is set
// For execFile, we need to separate command and arguments
export const rulesyncCmd = process.env.RULESYNC_CMD
  ? join(originalCwd, process.env.RULESYNC_CMD)
  : tsxPath;
export const rulesyncArgs = process.env.RULESYNC_CMD ? [] : [cliPath];

/**
 * Runs the `rulesync generate` command with the given target and feature.
 */
export async function runGenerate({
  target,
  features,
}: {
  target: string;
  features: string;
}): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(rulesyncCmd, [
    ...rulesyncArgs,
    "generate",
    "--targets",
    target,
    "--features",
    features,
  ]);
}

/**
 * Sets up a temporary test directory and provides lifecycle hooks for e2e tests.
 * Call within a describe block to register beforeEach/afterEach automatically.
 * Returns a getter for the testDir path (available after beforeEach runs).
 *
 * NOTE: `process.chdir()` is a global operation that affects the entire Node.js process.
 * E2e tests must run serially (maxWorkers: 1, fileParallelism: false in vitest.e2e.config.ts)
 * to avoid race conditions between concurrent test files.
 */
export function useTestDirectory(): { getTestDir: () => string } {
  let testDir = "";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanup: () => Promise<void> = async () => {};

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanup();
  });

  return {
    getTestDir: () => testDir,
  };
}
