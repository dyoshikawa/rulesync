import { basename, join, resolve } from "node:path";

import {
  ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME,
  ANTIGRAVITY_PLUGIN_MANIFEST_FOLDERS,
} from "../../constants/plugin-paths.js";
import { refusesWriteOutsideRoot } from "../../types/feature-processor.js";
import { quoteForLog, stripControlCharacters } from "../../utils/control-characters.js";
import { addTrailingNewline, fileExists, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { warnOnceWithFallback } from "../../utils/logger.js";
import type { FeatureGenerateResult } from "../../utils/result.js";

// The `name` pattern from Antigravity's hosted plugin manifest schema, which the
// loader still applies.
// @see https://antigravity.google/schemas/v1/plugin.json
const ANTIGRAVITY_PLUGIN_NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

// The stricter lowercase kebab-case form the Marketplace requires. Since CLI
// 1.4.9 `agy plugin validate` warns on any other `name` and fails under
// `--strict`.
// @see https://antigravity.google/docs/build-plugins
// @see https://github.com/google-antigravity/antigravity-cli/releases/tag/1.4.9
const ANTIGRAVITY_PLUGIN_STRICT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Lower-case a directory name and turn `_` into `-` (collapsing repeated and
 * trimming edge hyphens), so `My_Plugin` becomes `my-plugin`.
 */
function toStrictAntigravityPluginName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create the `plugin.json` manifest Antigravity requires before it treats a
 * directory as a plugin, so a tree generated from scratch actually loads.
 *
 * Only the required `name` is written, derived from the plugin directory's
 * name and normalized to the lowercase kebab-case form `agy plugin validate
 * --strict` and the Marketplace require; the other manifest fields (such as
 * `description`, `version` or `author`) have no rulesync source. An existing
 * manifest is never read or rewritten: it may carry hand-authored fields. A
 * manifest kept in one of the manifest folders counts as present too, so no
 * root stub is written next to it.
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
    if (await hasAntigravityPluginManifest(outputRoot)) {
      continue;
    }
    if (await refusesWriteOutsideRoot({ logger, rootPath: outputRoot, targetPath: filePath })) {
      continue;
    }

    const dirName = basename(resolve(outputRoot));
    const name = toStrictAntigravityPluginName(dirName);
    if (
      !ANTIGRAVITY_PLUGIN_NAME_PATTERN.test(dirName) ||
      !ANTIGRAVITY_PLUGIN_STRICT_NAME_PATTERN.test(name)
    ) {
      warnOnceWithFallback(
        logger,
        `Cannot derive an Antigravity plugin name from the directory ${quoteForLog(dirName)}: it must ` +
          `match ${ANTIGRAVITY_PLUGIN_NAME_PATTERN.source}. Create ${quoteForLog(filePath)} by hand ` +
          `with a valid "name".`,
      );
      continue;
    }
    if (name !== dirName) {
      warnOnceWithFallback(
        logger,
        `The Antigravity plugin directory ${quoteForLog(dirName)} is not lowercase kebab-case, ` +
          `which \`agy plugin validate --strict\` and the Marketplace reject, so ` +
          `${quoteForLog(filePath)} names the plugin ${quoteForLog(name)}.`,
      );
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

async function hasAntigravityPluginManifest(outputRoot: string): Promise<boolean> {
  const candidates = [
    join(outputRoot, ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME),
    ...ANTIGRAVITY_PLUGIN_MANIFEST_FOLDERS.map((folder) =>
      join(outputRoot, folder, ANTIGRAVITY_PLUGIN_MANIFEST_FILE_NAME),
    ),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return true;
    }
  }
  return false;
}
