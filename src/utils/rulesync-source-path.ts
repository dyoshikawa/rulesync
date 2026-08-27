import { join } from "node:path";

import { assertWritablePathInsideRoot, fileExists } from "./file.js";

/**
 * No `.rulesync/` source file exists for a feature at any of its candidate
 * paths.
 *
 * The loaders check several candidates before giving up, so by the time they
 * do there is no single `ENOENT` left to report — hence a type of its own.
 * Callers use it to tell "this feature simply has no source here", which is
 * ordinary, from "the source is there and could not be read", which is not.
 */
export class RulesyncSourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesyncSourceNotFoundError";
  }
}

/**
 * Whether a load failure means the source was absent rather than unreadable.
 *
 * Only {@link RulesyncSourceNotFoundError} counts, and every loader raises it
 * deliberately once each candidate path has been ruled out. A bare `ENOENT` is
 * not accepted here on purpose: by the time a loader is reading, it has already
 * established that the file is there, so an `ENOENT` from that read means the
 * source went away mid-run or something in the read path is broken — neither of
 * which should be reported as "this feature simply has no source".
 */
export function isRulesyncSourceMissing(error: unknown): boolean {
  return error instanceof RulesyncSourceNotFoundError;
}

export type RulesyncSourcePath = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type RulesyncSourceSettablePaths = {
  recommended: RulesyncSourcePath;
  legacy: readonly RulesyncSourcePath[];
};

export function getRulesyncSourceCandidates({
  paths,
}: {
  paths: RulesyncSourceSettablePaths;
}): RulesyncSourcePath[] {
  return [paths.recommended, ...paths.legacy];
}

export async function resolveRulesyncSourceWritePath({
  outputRoot,
  paths,
}: {
  outputRoot: string;
  paths: RulesyncSourceSettablePaths;
}): Promise<RulesyncSourcePath> {
  for (const candidate of getRulesyncSourceCandidates({ paths })) {
    const targetPath = join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath);
    if (await fileExists(targetPath)) {
      await assertWritablePathInsideRoot({ rootPath: outputRoot, targetPath });
      return candidate;
    }
  }
  await assertWritablePathInsideRoot({
    rootPath: outputRoot,
    targetPath: join(
      outputRoot,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    ),
  });
  return paths.recommended;
}
