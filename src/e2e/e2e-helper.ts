import { execFile } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, expect } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import type { ToolTarget } from "../types/tool-targets.js";

// Save original working directory
const originalCwd = process.cwd();

export const execFileAsync = promisify(execFile);

// Get the command to run from environment variable
// Default to running the TypeScript CLI entry point via tsx
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
  deleteFiles = false,
  check = false,
  simulateCommands = false,
  simulateSubagents = false,
  simulateSkills = false,
  inputRoot,
  env,
}: {
  target: string;
  features: string;
  global?: boolean;
  deleteFiles?: boolean;
  check?: boolean;
  simulateCommands?: boolean;
  simulateSubagents?: boolean;
  simulateSkills?: boolean;
  inputRoot?: string;
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
    ...(deleteFiles ? ["--delete"] : []),
    ...(check ? ["--check"] : []),
    ...(simulateCommands ? ["--simulate-commands"] : []),
    ...(simulateSubagents ? ["--simulate-subagents"] : []),
    ...(simulateSkills ? ["--simulate-skills"] : []),
    ...(inputRoot ? ["--input-root", inputRoot] : []),
  ];
  return execFileAsync(rulesyncCmd, args, env ? { env: { ...process.env, ...env } } : {});
}

/**
 * Runs the `rulesync import` command with the given target and feature.
 */
export async function runImport({
  target,
  features,
}: {
  target: string;
  features: string;
}): Promise<{ stdout: string; stderr: string }> {
  const args = [...rulesyncArgs, "import", "--targets", target, "--features", features];
  return execFileAsync(rulesyncCmd, args);
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

type ProcessorTargets = {
  getToolTargets(options?: { global?: boolean; importOnly?: boolean }): ToolTarget[];
};

/**
 * Asserts that an e2e generate/global happy-path matrix stays in lock-step with
 * the tool targets a feature processor actually declares, so adding a tool to a
 * processor without wiring it into the matrix (or dropping one) fails CI instead
 * of silently eroding coverage.
 *
 * The declared targets (from `getToolTargets`) must partition exactly into
 * `testedTargets` (tools with an entry in the matrix `it.each` dictionary) and
 * `untested` (tools intentionally excluded from this matrix — e.g. tools whose
 * output only exists in another scope, or that merge into a shared file). Every
 * excluded tool must be listed explicitly with a reason so the omission is a
 * conscious decision rather than an accidental gap.
 *
 * `-legacy` targets are dropped from the comparison: they are duplicate aliases
 * that the same tables/generators exclude, and are never exercised end-to-end.
 *
 * Mirrors the "derive from the implementation, fail on drift" idiom already used
 * by the TOOL_DISPLAY completeness check and the gitignore derivation.
 */
export function assertGenerateMatrixCoversTargets({
  processor,
  testedTargets,
  untested = [],
  global = false,
}: {
  processor: ProcessorTargets;
  testedTargets: readonly string[];
  untested?: readonly string[];
  global?: boolean;
}): void {
  const declared = processor
    .getToolTargets({ global })
    .filter((target) => !target.endsWith("-legacy"));
  const declaredSet = new Set<string>(declared);

  const stray = [...testedTargets, ...untested].filter((t) => !declaredSet.has(t)).toSorted();
  expect(
    stray,
    `These matrix/untested entries are not declared by the processor (stale or mistyped): ${stray.join(", ")}`,
  ).toEqual([]);

  const covered = new Set<string>([...testedTargets, ...untested]);
  const uncovered = declared.filter((t) => !covered.has(t)).toSorted();
  expect(
    uncovered,
    `These tools are declared by the processor but missing from the e2e matrix. Add each to the matrix dictionary, or to the \`untested\` list with a reason: ${uncovered.join(", ")}`,
  ).toEqual([]);
}
