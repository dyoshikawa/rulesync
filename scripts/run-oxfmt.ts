import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

export const repoRoot = join(import.meta.dirname, "..");

/**
 * Format generated files with the repo's formatter so drift checks compare
 * stable output. Shared by the generator scripts (docs content, supported-tools
 * tables, JSON schemas) so a fix here reaches every call site.
 *
 * npx is npx.cmd on Windows; a shell resolves it. `--no-install` keeps npx from
 * silently fetching a different oxfmt version when the pinned devDependency is
 * missing, which would surface as an unexplained drift-check failure. stderr is
 * inherited so a formatter failure stays diagnosable.
 */
export const runOxfmt = (paths: string[]): void => {
  if (paths.length === 0) {
    return;
  }
  execFileSync("npx", ["--no-install", "oxfmt", ...paths.map((path) => relative(repoRoot, path))], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
};
