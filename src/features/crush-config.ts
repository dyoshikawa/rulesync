import { join } from "node:path";

import {
  CRUSH_CONFIG_FILE_NAME,
  CRUSH_GLOBAL_DIR,
  CRUSH_HIDDEN_CONFIG_FILE_NAME,
} from "../constants/crush-paths.js";
import { readFileContentOrNull } from "../utils/file.js";
import { parseSharedConfig } from "./shared/shared-config-gateway.js";

/**
 * Where Crush's JSON config lives for a scope, before the project-scope twin
 * is resolved: `<project>/crush.json` or `~/.config/crush/crush.json`. This is
 * also the key every adapter reports through `getSettablePaths`, so the
 * shared-config ownership declaration, the gitignore derivation and the
 * shared-write ordering all see one file per scope.
 */
export function getCrushConfigSettablePaths({ global = false }: { global?: boolean } = {}): {
  relativeDirPath: string;
  relativeFilePath: string;
} {
  return {
    relativeDirPath: global ? CRUSH_GLOBAL_DIR : ".",
    relativeFilePath: CRUSH_CONFIG_FILE_NAME,
  };
}

export type CrushConfigLocation = {
  relativeDirPath: string;
  relativeFilePath: string;
  /** The absolute path of the file the adapter reads and writes. */
  filePath: string;
  /** The file's current content, or `null` when no readable file exists. */
  fileContent: string | null;
};

/**
 * Resolves which Crush config file an adapter should read and write.
 *
 * At project scope Crush discovers both `.crush.json` and `crush.json` in the
 * working directory and merges every file it finds, with `.crush.json`
 * winning key by key. A key written to `crush.json` while a `.crush.json`
 * exists could therefore be shadowed, so an existing `.crush.json` is
 * preferred; otherwise `crush.json` is used (and created when neither
 * exists). The global scope has a single spelling.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
 */
export async function resolveCrushConfigFile({
  outputRoot,
  global = false,
}: {
  outputRoot: string;
  global?: boolean;
}): Promise<CrushConfigLocation> {
  const paths = getCrushConfigSettablePaths({ global });
  const configDir = join(outputRoot, paths.relativeDirPath);

  if (!global) {
    const hiddenPath = join(configDir, CRUSH_HIDDEN_CONFIG_FILE_NAME);
    const hiddenContent = await readFileContentOrNull(hiddenPath);
    if (hiddenContent !== null) {
      return {
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: CRUSH_HIDDEN_CONFIG_FILE_NAME,
        filePath: hiddenPath,
        fileContent: hiddenContent,
      };
    }
  }

  const filePath = join(configDir, paths.relativeFilePath);
  return {
    relativeDirPath: paths.relativeDirPath,
    relativeFilePath: paths.relativeFilePath,
    filePath,
    fileContent: await readFileContentOrNull(filePath),
  };
}

/**
 * Single spelling of the crush.json codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for both scopes: fail closed on an
 * unparseable root rather than replacing the user's Crush config with
 * generated output.
 */
export function parseCrushConfig(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}
