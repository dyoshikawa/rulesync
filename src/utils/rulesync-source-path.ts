import { join } from "node:path";

import { assertWritablePathInsideRoot, fileExists } from "./file.js";

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
