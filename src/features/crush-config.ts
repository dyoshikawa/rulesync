import { join } from "node:path";

import {
  CRUSH_CONFIG_FILE_NAME,
  CRUSH_GLOBAL_DIR,
  CRUSH_HIDDEN_CONFIG_FILE_NAME,
} from "../constants/crush-paths.js";
import { readFileContentOrNull } from "../utils/file.js";
import { type Logger } from "../utils/logger.js";
import { isPrototypePollutionKey } from "../utils/prototype-pollution.js";
import { isRecord } from "../utils/type-guards.js";
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
  /**
   * The lower-priority sibling Crush merges beneath `filePath` — the
   * `crush.json` next to a chosen `.crush.json` — when it exists. Never set
   * at global scope, where there is a single spelling.
   */
  twin?: { filePath: string; fileContent: string };
};

/**
 * Resolves which Crush config file an adapter should read and write.
 *
 * At project scope Crush discovers both `.crush.json` and `crush.json` in the
 * working directory and merges every file it finds with `.crush.json` on top
 * (objects merge recursively, lists are concatenated, scalars are overridden).
 * Neither file therefore hides the other: an entry left in `crush.json` stays
 * in effect next to whatever `.crush.json` says. An existing `.crush.json` is
 * preferred because the user chose that spelling; otherwise `crush.json` is
 * used (and created when neither exists). The global scope has a single
 * spelling.
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
  const filePath = join(configDir, paths.relativeFilePath);
  const fileContent = await readFileContentOrNull(filePath);

  if (!global) {
    const hiddenPath = join(configDir, CRUSH_HIDDEN_CONFIG_FILE_NAME);
    const hiddenContent = await readFileContentOrNull(hiddenPath);
    if (hiddenContent !== null) {
      return {
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: CRUSH_HIDDEN_CONFIG_FILE_NAME,
        filePath: hiddenPath,
        fileContent: hiddenContent,
        ...(fileContent === null ? {} : { twin: { filePath, fileContent } }),
      };
    }
  }

  return {
    relativeDirPath: paths.relativeDirPath,
    relativeFilePath: paths.relativeFilePath,
    filePath,
    fileContent,
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

/**
 * Combine two Crush config documents the way Crush itself does
 * (`github.com/qjebbs/go-jsons`): objects merge recursively, arrays are
 * concatenated with `base` first, and any other value from `override` wins.
 */
export function mergeCrushConfigs({
  base,
  override,
}: {
  base: Record<string, unknown>;
  override: Record<string, unknown>;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPrototypePollutionKey(key)) continue;
    const current = merged[key];
    if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeCrushConfigs({ base: current, override: value });
    } else if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = [...current, ...value];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * The content an import should read for a resolved location: the chosen file
 * merged over its twin when both exist, so a server, hook or tool entry that
 * only the lower-priority `crush.json` declares is imported too — Crush sees
 * it, so rulesync should as well.
 */
export function crushConfigImportContent(location: CrushConfigLocation): string {
  const own = location.fileContent ?? "{}";
  if (location.twin === undefined) {
    return own;
  }
  const merged = mergeCrushConfigs({
    base: parseCrushConfig(location.twin.fileContent, location.twin.filePath),
    override: parseCrushConfig(own, location.filePath),
  });
  return JSON.stringify(merged, null, 2);
}

function lookupPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function isNonEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== undefined;
}

/**
 * Warn when the twin Crush merges beneath the written file still carries a
 * value at one of the paths this feature owns. Rulesync only rewrites the
 * chosen file, and because Crush concatenates lists and merges objects across
 * the pair, such an entry — typically one an earlier generate wrote to
 * `crush.json` before the user added a `.crush.json` — stays in effect until
 * removed by hand, and cannot be retracted from `.rulesync/`.
 */
export function warnCrushTwinLeftovers({
  location,
  ownedPaths,
  logger,
}: {
  location: CrushConfigLocation;
  ownedPaths: readonly (readonly string[])[];
  logger?: Logger;
}): void {
  if (location.twin === undefined) return;
  let twin: Record<string, unknown>;
  try {
    twin = parseCrushConfig(location.twin.fileContent, location.twin.filePath);
  } catch {
    // An unreadable twin is Crush's problem to report; the chosen file is
    // still written on its own terms.
    return;
  }
  const leftovers = ownedPaths
    .filter((path) => isNonEmptyValue(lookupPath(twin, path)))
    .map((path) => `"${path.join(".")}"`);
  if (leftovers.length === 0) return;
  logger?.warn(
    `Crush merges ${location.twin.filePath} beneath ${location.filePath} (objects recursively, ` +
      `lists concatenated), so the ${leftovers.join(", ")} entries it still carries stay in ` +
      `effect and are not managed by rulesync; remove them from that file by hand.`,
  );
}
