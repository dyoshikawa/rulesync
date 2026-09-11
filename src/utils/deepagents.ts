import { isAbsolute, relative, resolve } from "node:path";

import { DEEPAGENTS_DIR } from "../constants/deepagents-paths.js";
import { checkPathTraversal, getHomeDirectory } from "./file.js";
import { getToolRulesyncOutputRoot } from "./tool-home.js";

const DEEPAGENTS_HOME_ENV = "DEEPAGENTS_HOME";

/**
 * The profile root dcode reads when `DEEPAGENTS_HOME` is set, or `undefined`
 * when the default `~/.deepagents/` applies.
 *
 * Upstream captures the variable once at launch and accepts exactly two
 * spellings: an absolute path, or one beginning with `~/` (expanded against the
 * launch home). Anything else — a bare `~`, a `~user` form, a relative path —
 * makes dcode refuse to start, so the same value is rejected here rather than
 * resolved against the working directory: there is no location such a value
 * could name that dcode would read.
 *
 * @see https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/_paths.py
 */
export function getDeepagentsHome(): string | undefined {
  const configured = process.env[DEEPAGENTS_HOME_ENV]?.trim();
  if (!configured) return undefined;
  if (configured.startsWith("~/")) {
    return resolve(getHomeDirectory(), configured.slice(2).replace(/^\/+/, ""));
  }
  if (isAbsolute(configured)) return resolve(configured);
  throw new Error(
    `Invalid ${DEEPAGENTS_HOME_ENV} ${JSON.stringify(configured)}: dcode accepts only an absolute path or a path beginning with "~/", so it would not start with this value. Unset it or point it at an absolute path.`,
  );
}

/**
 * Map a canonical `.deepagents/...` path constant onto the directory rulesync
 * actually writes in the requested scope.
 *
 * Project scope keeps the constant as-is (the project tree is `.deepagents/`
 * everywhere). Global scope without an override keeps it too, under the home
 * output root. When `DEEPAGENTS_HOME` is set, that directory *is* the profile
 * root, so the `.deepagents` prefix is stripped: `~/.deepagents/agent/skills`
 * becomes `$DEEPAGENTS_HOME/agent/skills`.
 */
export function getDeepagentsRelativeDirPath({
  global,
  relativeDirPath,
}: {
  global: boolean;
  relativeDirPath: string;
}): string {
  if (!global || !getDeepagentsHome()) return relativeDirPath;

  const relativePath = relative(DEEPAGENTS_DIR, relativeDirPath);
  try {
    // The input is checked as well as the de-prefixed result: `relative()`
    // normalizes `..` away, so a path that walks out of `.deepagents` and back
    // in would otherwise pass a containment check on the result alone.
    checkPathTraversal({ relativePath: relativeDirPath, intendedRootDir: "." });
    checkPathTraversal({ relativePath, intendedRootDir: DEEPAGENTS_DIR });
  } catch {
    throw new Error(`deepagents global path must be within ${DEEPAGENTS_DIR}: ${relativeDirPath}`);
  }
  // `.` rather than `""` for the profile root itself, so the result always
  // names a directory the way the constants it replaces do.
  return relativePath || ".";
}

export function getDeepagentsRulesyncOutputRoot({
  nativeOutputRoot,
  global,
}: {
  nativeOutputRoot: string;
  global: boolean;
}): string {
  return getToolRulesyncOutputRoot({ nativeOutputRoot, global, toolHome: getDeepagentsHome });
}
