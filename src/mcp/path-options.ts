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

/**
 * Rejects a `file://` git source outside the project. Used by MCP `add` on
 * its source argument and by MCP `install` on every source the resolved config
 * declares (a model can write that config through `mcp put` or a project file).
 *
 * The git transport clones any URL `git` accepts, a local `file:///` repository
 * included, so without this an agent (possibly steered by repository text)
 * could copy skill- and rule-shaped content from any repository the operator
 * can read into the project.
 *
 * The path is judged the way git reads it, not through a WHATWG `URL`: that
 * parser drops a `?query` or `#fragment`, turns `\` into `/` and folds `..`
 * segments, none of which git does, so `file:///project/x#/../../secret`
 * would be judged as `/project/x` while git opens `/secret`. A URL with a
 * host (`file://localhost/`), a `?`, a `#` or a `\` is refused outright, and
 * the rest is percent-decoded (git decodes it too) and held to the same
 * containment as the path options, which also rejects any `..` segment.
 */
export async function assertFileSourceWithinCwd(source: string): Promise<void> {
  const trimmed = source.trim();
  if (!/^file:/iu.test(trimmed)) {
    return;
  }
  const rawPath = /^file:\/\/(\/.*)$/isu.exec(trimmed)?.[1];
  if (rawPath === undefined || /[?#\\]/u.test(rawPath)) {
    throw new Error(
      `A file:// source must be a plain file:/// URL without a host, '?', '#' or '\\': ${trimmed}`,
    );
  }
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch (error) {
    throw new Error(`A file:// source has invalid percent-encoding: ${trimmed}`, { cause: error });
  }
  if (path.includes("\0")) {
    throw new Error(`A file:// source must not contain a NUL character: ${trimmed}`);
  }
  // `file:///C:/repo` names `C:/repo` on Windows.
  if (process.platform === "win32" && /^\/[a-z]:/iu.test(path)) {
    path = path.slice(1);
  }
  await assertPathOptionWithinCwd({ path, label: "A file:// source" });
}
