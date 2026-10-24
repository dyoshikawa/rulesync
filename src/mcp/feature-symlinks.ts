import { join } from "node:path";

import {
  assertNoSymlinkBelowRoot,
  assertTreeContainsNoSymlinks,
  fileExistsStrict,
  PathOutsideRootError,
} from "../utils/file.js";
import {
  getRulesyncSourceCandidates,
  type RulesyncSourceSettablePaths,
} from "../utils/rulesync-source-path.js";

/**
 * Refuses an MCP feature read or write whose target is reached through a
 * symbolic link below the feature's directory — the target itself included.
 *
 * The MCP server may run in a checkout the operator does not trust, and an
 * agent may be steered by its contents. A committed link such as
 * `.rulesync/rules/notes.md -> ~/.ssh/id_rsa` would otherwise let a `get`
 * hand any operator-readable file to the model, and a `put` overwrite any
 * operator-writable one. `featureDirPath` itself (and `.rulesync` above it)
 * may still be a link, for example into a dotfiles repository, which the CLI
 * follows as well; only what lies below it is confined.
 *
 * Every existing component between the feature directory and the target is
 * `lstat`ed, so call this immediately before each read or write, and before
 * creating a missing parent directory (which `mkdir -p` would otherwise create
 * through a linked component).
 */
export async function assertNoSymlinkInFeaturePath({
  featureDirPath,
  targetPath,
}: {
  featureDirPath: string;
  targetPath: string;
}): Promise<void> {
  await assertNoSymlinkBelowRoot({ rootPath: featureDirPath, targetPath });
}

/**
 * {@link assertNoSymlinkInFeaturePath} for a directory read as a whole (a
 * skill): the directory must not be reached through a link, and no entry
 * anywhere inside it may be a link either.
 */
export async function assertNoSymlinkInFeatureTree({
  featureDirPath,
  dirPath,
}: {
  featureDirPath: string;
  dirPath: string;
}): Promise<void> {
  await assertNoSymlinkInFeaturePath({ featureDirPath, targetPath: dirPath });
  await assertTreeContainsNoSymlinks(dirPath, { operation: "read" });
}

/**
 * {@link assertNoSymlinkInFeaturePath} for a single-file source with legacy
 * names (`.rulesync/mcp.jsonc`, `.rulesync/hooks.jsonc`, ...): the candidates
 * are checked in the order the loader reads them, up to the first one that
 * exists, which is the file a `get` would return.
 */
export async function assertNoSymlinkInRulesyncSource({
  outputRoot,
  paths,
}: {
  outputRoot: string;
  paths: RulesyncSourceSettablePaths;
}): Promise<void> {
  for (const candidate of getRulesyncSourceCandidates({ paths })) {
    const featureDirPath = join(outputRoot, candidate.relativeDirPath);
    const targetPath = join(featureDirPath, candidate.relativeFilePath);
    await assertNoSymlinkInFeaturePath({ featureDirPath, targetPath });
    if (await fileExistsStrict(targetPath)) {
      return;
    }
  }
}

/**
 * Whether an error is one of the refusals above rather than a filesystem
 * failure, so a `list` can skip a linked entry quietly — it would be refused
 * by `get` anyway — while still reporting a file it could not read.
 */
export function isFeatureSymlinkRefusal(error: unknown): boolean {
  return error instanceof PathOutsideRootError;
}
