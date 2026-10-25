/**
 * Shared exclusion lists for the nested rule-file scans (`AGENTS.md`,
 * `REASONIX.md`), which walk the whole project tree on import rather than a
 * rulesync-owned directory.
 */

/**
 * Dependency trees never scanned for nested rule files, at any depth. A rule
 * file there describes somebody else's project, and neither name is ever a
 * package name. Hidden directories are excluded separately, because a rule
 * file inside one is another tool's generated output (rulesync writes several
 * itself).
 */
export const NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH = ["node_modules", "__pycache__"];

/**
 * Build, vendoring and scratch directories, excluded at the **project root
 * only**. A top-level `build/` is a build directory; `packages/build/` is a
 * package, and dropping it silently would lose a real subproject.
 */
export const NESTED_SCAN_EXCLUDED_ROOT_DIRS = [
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "tmp",
  "temp",
  "venv",
];

/**
 * The ignore globs for both exclusion lists, in the order the nested scans list
 * them: the any-depth dependency trees, then the root-only directories.
 */
export function nestedScanExclusionGlobs(): string[] {
  return [
    ...NESTED_SCAN_EXCLUDED_DIRS_ANY_DEPTH.map((dir) => `**/${dir}/**`),
    ...NESTED_SCAN_EXCLUDED_ROOT_DIRS.map((dir) => `${dir}/**`),
  ];
}
