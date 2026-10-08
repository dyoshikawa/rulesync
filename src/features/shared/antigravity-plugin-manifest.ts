import { basename, join, resolve } from "node:path";

import { ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME } from "../../constants/plugin-paths.js";
import { refusesWriteOutsideRoot } from "../../types/feature-processor.js";
import { quoteForLog, stripControlCharacters } from "../../utils/control-characters.js";
import { addTrailingNewline, fileExists, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { warnOnceWithFallback } from "../../utils/logger.js";
import type { FeatureGenerateResult } from "../../utils/result.js";

// The `name` pattern from Antigravity's published plugin manifest schema.
// @see https://antigravity.google/docs/plugins
const ANTIGRAVITY_PLUGIN_NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

/**
 * Create the `plugin.json` manifest Antigravity requires before it treats a
 * directory as a plugin, so a tree generated from scratch actually loads.
 *
 * The manifest declares only `name` and `description`, and rejects anything
 * else, so the one required field is derived from the plugin directory's name.
 * An existing manifest is never read or rewritten: it may carry a
 * hand-authored `name` or `description` that rulesync has no source for.
 */
export async function ensureAntigravityPluginManifests({
  outputRoots,
  dryRun,
  logger,
}: {
  outputRoots: readonly string[];
  dryRun: boolean;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const paths: string[] = [];

  for (const outputRoot of outputRoots) {
    const filePath = join(outputRoot, ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME);
    if (await fileExists(filePath)) {
      continue;
    }
    if (await refusesWriteOutsideRoot({ logger, rootPath: outputRoot, targetPath: filePath })) {
      continue;
    }

    const name = basename(resolve(outputRoot));
    if (!ANTIGRAVITY_PLUGIN_NAME_PATTERN.test(name)) {
      warnOnceWithFallback(
        logger,
        `Cannot derive an Antigravity plugin name from the directory ${quoteForLog(name)}: it must ` +
          `match ${ANTIGRAVITY_PLUGIN_NAME_PATTERN.source}. Create ${quoteForLog(filePath)} by hand ` +
          `with a valid "name".`,
      );
      continue;
    }

    const content = addTrailingNewline(JSON.stringify({ name }, null, 2));
    if (dryRun) {
      logger.info(`[DRY RUN] Would write: ${stripControlCharacters(filePath)}`);
    } else {
      await writeFileContent(filePath, content);
    }
    paths.push(ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME);
  }

  // The manifest is derived from the output root, not from a `.rulesync/`
  // source, so it has no source that could fail to load.
  return { count: paths.length, paths, hasDiff: paths.length > 0, sourceLoadFailed: false };
}
