import { isAbsolute, relative, resolve, sep } from "node:path";

import { checkPathTraversal } from "../utils/file.js";

/**
 * Rejects a path option an MCP caller passed unless it stays inside the
 * project (`process.cwd()`).
 *
 * The CLI accepts any normalized absolute path for options such as
 * `--output-roots`, because the person typing it owns the machine. An MCP
 * caller is an agent acting on the user's behalf, so it may only point
 * rulesync at directories inside the project the server was started for —
 * never at a sibling project, the home directory or a system path. Both
 * relative paths (resolved against cwd) and absolute paths under cwd are
 * accepted.
 */
export function assertPathOptionWithinCwd({ path, label }: { path: string; label: string }): void {
  if (path.trim() === "") {
    throw new Error(`${label} must not be an empty string.`);
  }

  const cwd = resolve(process.cwd());

  try {
    checkPathTraversal({ relativePath: path, intendedRootDir: cwd });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must stay inside the project directory (${detail}).`, {
      cause: error,
    });
  }

  // `checkPathTraversal` catches `..` escapes; a path on another drive (Windows)
  // yields an absolute `relative()` result instead, which is just as far outside.
  const rel = relative(cwd, resolve(cwd, path));
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the project directory.`);
  }
}

/** Applies {@link assertPathOptionWithinCwd} to every entry of an optional list. */
export function assertPathOptionsWithinCwd({
  paths,
  label,
}: {
  paths: readonly string[] | undefined;
  label: string;
}): void {
  for (const path of paths ?? []) {
    assertPathOptionWithinCwd({ path, label });
  }
}
