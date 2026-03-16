import { basename, join } from "node:path";

import type { SourceEntry } from "../config/config.js";
import { RULESYNC_SOURCES_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { formatError } from "../utils/error.js";
import { directoryExists, fileExists, findFilesByGlobs, readFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { normalizeSourceKey } from "./sources-lock.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceCacheEntry = {
  /** The original source key (e.g. "owner/repo"). */
  sourceKey: string;
  /** Absolute path to the source's cache directory. */
  cachePath: string;
};

export type SourceItem = {
  /** Item name (e.g. "my-skill" for a dir, "coding.md" for a file). */
  name: string;
  /** Absolute path to the item (directory for skills, file for rules/commands/subagents). */
  path: string;
  /** The source this item came from. */
  sourceKey: string;
};

// ---------------------------------------------------------------------------
// Cache directory naming
// ---------------------------------------------------------------------------

/**
 * Convert a normalized source key to a filesystem-safe directory name.
 * Replaces `/` with `--` to avoid nested directories.
 */
export function sourceKeyToDirName(sourceKey: string): string {
  const normalized = normalizeSourceKey(sourceKey);
  return normalized.replace(/\//g, "--");
}

// ---------------------------------------------------------------------------
// Ordered source cache resolution
// ---------------------------------------------------------------------------

/**
 * Get ordered source cache entries based on config's sources array.
 * Returns only entries whose cache directories exist on disk.
 */
export async function getOrderedSourceCaches(params: {
  baseDir: string;
  sources: SourceEntry[];
}): Promise<SourceCacheEntry[]> {
  const { baseDir, sources } = params;
  const entries: SourceCacheEntry[] = [];

  for (const source of sources) {
    const dirName = sourceKeyToDirName(source.source);
    const cachePath = join(baseDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, dirName);

    if (await directoryExists(cachePath)) {
      entries.push({ sourceKey: source.source, cachePath });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Directory-item loading (skills: subdirectories, rules/commands/subagents: files)
// ---------------------------------------------------------------------------

/**
 * Load directory-based items (each item is a subdirectory) from source caches.
 * Used for skills where each skill is a directory containing files.
 */
export async function loadDirItemsFromSources(params: {
  sources: SourceCacheEntry[];
  featureDirName: string;
  localNames: Set<string>;
}): Promise<SourceItem[]> {
  const { sources, featureDirName, localNames } = params;
  const items: SourceItem[] = [];
  const seen = new Set<string>(localNames);

  for (const source of sources) {
    const featureDir = join(source.cachePath, featureDirName);
    if (!(await directoryExists(featureDir))) continue;

    const dirPaths = await findFilesByGlobs(join(featureDir, "*"), { type: "dir" });
    for (const dirPath of dirPaths) {
      const name = basename(dirPath);
      if (seen.has(name)) {
        logger.debug(
          `Skipping ${featureDirName} "${name}" from ${source.sourceKey}: already provided.`,
        );
        continue;
      }
      seen.add(name);
      items.push({ name, path: dirPath, sourceKey: source.sourceKey });
    }
  }

  return items;
}

/**
 * Load file-based items (each item is a single file) from source caches.
 * Used for rules, commands, subagents where each item is a .md file.
 */
export async function loadFileItemsFromSources(params: {
  sources: SourceCacheEntry[];
  featureDirName: string;
  globPattern: string;
  localNames: Set<string>;
}): Promise<SourceItem[]> {
  const { sources, featureDirName, globPattern, localNames } = params;
  const items: SourceItem[] = [];
  const seen = new Set<string>(localNames);

  for (const source of sources) {
    const featureDir = join(source.cachePath, featureDirName);
    if (!(await directoryExists(featureDir))) continue;

    const filePaths = await findFilesByGlobs(join(featureDir, globPattern));
    for (const filePath of filePaths) {
      const name = basename(filePath);
      if (seen.has(name)) {
        logger.debug(
          `Skipping ${featureDirName} "${name}" from ${source.sourceKey}: already provided.`,
        );
        continue;
      }
      seen.add(name);
      items.push({ name, path: filePath, sourceKey: source.sourceKey });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Single-file feature merging
// ---------------------------------------------------------------------------

/**
 * Load and merge a JSON feature file across source caches.
 * Local content is the base; sources overlay in declaration order.
 * The mergeFn receives (accumulated, overlay) and returns the merged result.
 */
export async function loadAndMergeJsonFeature<T>(params: {
  sources: SourceCacheEntry[];
  fileName: string;
  localContent: T | undefined;
  mergeFn: (base: T, overlay: T) => T;
  parseFn?: (raw: string) => T;
}): Promise<T | undefined> {
  const { sources, fileName, localContent, mergeFn, parseFn } = params;
  const parse = parseFn ?? ((raw: string): T => JSON.parse(raw));
  let result: T | undefined = localContent;

  for (const source of sources) {
    const filePath = join(source.cachePath, fileName);
    if (!(await fileExists(filePath))) continue;

    try {
      const content = await readFileContent(filePath);
      const parsed = parse(content);

      if (result === undefined) {
        result = parsed;
      } else {
        result = mergeFn(result, parsed);
      }
      logger.debug(`Merged ${fileName} from source ${source.sourceKey}`);
    } catch (error) {
      logger.warn(
        `Failed to parse ${fileName} from source ${source.sourceKey}: ${formatError(error)}`,
      );
    }
  }

  return result;
}

/**
 * Load and merge a text feature file across source caches.
 * Local content is the base; sources overlay in declaration order.
 */
export async function loadAndMergeTextFeature(params: {
  sources: SourceCacheEntry[];
  fileName: string;
  localContent: string | undefined;
  mergeFn: (base: string, overlay: string) => string;
}): Promise<string | undefined> {
  const { sources, fileName, localContent, mergeFn } = params;
  let result: string | undefined = localContent;

  for (const source of sources) {
    const filePath = join(source.cachePath, fileName);
    if (!(await fileExists(filePath))) continue;

    try {
      const content = await readFileContent(filePath);

      if (result === undefined) {
        result = content;
      } else {
        result = mergeFn(result, content);
      }
      logger.debug(`Merged ${fileName} from source ${source.sourceKey}`);
    } catch (error) {
      logger.warn(
        `Failed to read ${fileName} from source ${source.sourceKey}: ${formatError(error)}`,
      );
    }
  }

  return result;
}

/**
 * List all files under a source cache directory for integrity tracking.
 * Returns relative paths within the source cache (e.g. "skills/my-skill/SKILL.md").
 */
export async function listSourceCacheFiles(cachePath: string): Promise<string[]> {
  if (!(await directoryExists(cachePath))) return [];
  const files = await findFilesByGlobs(join(cachePath, "**", "*"), { type: "file" });
  return files.map((f) => f.substring(cachePath.length + 1));
}
