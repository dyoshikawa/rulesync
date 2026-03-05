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
  global = false,
  env,
}: {
  target: string;
  features: string;
  global?: boolean;
  env?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string }> {
  const args = [
    ...rulesyncArgs,
    "generate",
    "--targets",
    target,
    "--features",
    features,
    ...(global ? ["--global"] : []),
  ];
  return execFileAsync(rulesyncCmd, args, env ? { env: { ...process.env, ...env } } : {});
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

/**
 * Sets up two temporary directories for global mode e2e tests:
 * - projectDir: working directory (contains .rulesync source files)
 * - homeDir: simulated home directory (where global output is written)
 *
 * NOTE: Same serial execution requirements as useTestDirectory apply.
 */
export function useGlobalTestDirectories(): {
  getProjectDir: () => string;
  getHomeDir: () => string;
} {
  let projectDir = "";
  let homeDir = "";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupProject: () => Promise<void> = async () => {};
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupHome: () => Promise<void> = async () => {};

  beforeEach(async () => {
    ({ testDir: projectDir, cleanup: cleanupProject } = await setupTestDirectory());
    ({ testDir: homeDir, cleanup: cleanupHome } = await setupTestDirectory({ home: true }));
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupProject();
    await cleanupHome();
  });

  return {
    getProjectDir: () => projectDir,
    getHomeDir: () => homeDir,
  };
}
