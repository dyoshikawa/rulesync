import { lstat, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
 *
 * The check is made on real paths: a committed symbolic link inside the
 * project that points outside it (`shared -> ../other-project`) is rejected,
 * and a cwd reached through a symbolic link still accepts paths spelled with
 * either its linked or its real location. A path that does not exist yet is
 * judged by the real path of its longest existing ancestor.
 */
export async function assertPathOptionWithinCwd({
  path,
  label,
}: {
  path: string;
  label: string;
}): Promise<void> {
  if (path.trim() === "") {
    throw new Error(`${label} must not be an empty string.`);
  }

  // Only a real `..` segment is traversal; a name such as `..cache` is not.
  if (path.split(/[/\\]/).includes("..")) {
    throw new Error(
      `${label} must stay inside the project directory ('..' segments are not allowed).`,
    );
  }

  const cwd = resolve(process.cwd());
  const realCwd = await realpath(cwd);
  const realTarget = await realpathOfLongestExistingPrefix(resolve(cwd, path));

  if (!isWithin({ root: realCwd, path: realTarget })) {
    throw new Error(`${label} must stay inside the project directory.`);
  }
}

/** Applies {@link assertPathOptionWithinCwd} to an optional path, skipping it when absent. */
export async function assertOptionalPathOptionWithinCwd({
  path,
  label,
}: {
  path: string | undefined;
  label: string;
}): Promise<void> {
  if (path !== undefined) {
    await assertPathOptionWithinCwd({ path, label });
  }
}

/** Applies {@link assertPathOptionWithinCwd} to every entry of an optional list. */
export async function assertPathOptionsWithinCwd({
  paths,
  label,
}: {
  paths: readonly string[] | undefined;
  label: string;
}): Promise<void> {
  for (const path of paths ?? []) {
    await assertPathOptionWithinCwd({ path, label });
  }
}

function isWithin({ root, path }: { root: string; path: string }): boolean {
  const rel = relative(root, path);
  // A path on another drive (Windows) yields an absolute `relative()` result.
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * How many dangling symbolic links one path may pass through. `realpath`
 * itself reports a loop of existing links (`ELOOP`); this bounds a chain of
 * links whose final target does not exist yet.
 */
const MAX_DANGLING_LINK_HOPS = 40;

/**
 * Resolves symbolic links in the longest existing ancestor of an absolute path
 * and re-appends the segments that do not exist yet.
 *
 * A dangling symbolic link (`link -> /elsewhere/new`) makes `realpath` fail
 * with `ENOENT` exactly like a missing path, yet writing through it would
 * create its target. So a component that is missing for `realpath` but present
 * for `lstat` is followed by hand, and its target is what gets judged.
 */
async function realpathOfLongestExistingPrefix(absolutePath: string, hops = 0): Promise<string> {
  const missingSegments: string[] = [];
  let current = absolutePath;

  for (;;) {
    try {
      const real = await realpath(current);
      return join(real, ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const danglingTarget = await readDanglingLinkTarget(current);
      if (danglingTarget !== undefined) {
        if (hops >= MAX_DANGLING_LINK_HOPS) {
          throw new Error(`Too many symbolic links while resolving ${absolutePath}`, {
            cause: error,
          });
        }
        // A relative target is resolved by the OS against the link's real
        // parent directory, not the (possibly symlinked) spelling used to
        // reach it. The parent exists, since `lstat` found the link in it.
        const realParent = await realpath(dirname(current));
        return realpathOfLongestExistingPrefix(
          join(resolve(realParent, danglingTarget), ...missingSegments),
          hops + 1,
        );
      }
      const parent = dirname(current);
      if (parent === current) {
        return absolutePath;
      }
      missingSegments.unshift(basename(current));
      current = parent;
    }
  }
}

/** The target of `path` when it is a symbolic link (one `realpath` could not follow), else `undefined`. */
async function readDanglingLinkTarget(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    return stats.isSymbolicLink() ? await readlink(path) : undefined;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
