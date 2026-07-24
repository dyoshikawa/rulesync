import { join } from "node:path";

import { fileExists } from "./file.js";

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
    if (await fileExists(join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath))) {
      return candidate;
    }
  }
  return paths.recommended;
}
