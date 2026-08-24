import { join } from "node:path";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { fileContentIsEmptyPayload, fileContentsEquivalent } from "../utils/content-equivalence.js";
import {
  addTrailingNewline,
  applyFileMode,
  fileExists,
  restoreMissingExecutableBit,
  readFileContentOrNull,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import type { WriteResult } from "../utils/result.js";
import { AiFile } from "./ai-file.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class FeatureProcessor {
  protected readonly outputRoot: string;
  /**
   * Ordered, non-empty list of rulesync source-tree directories. Each entry
   * is a source tree itself — the directory that directly contains feature
   * subdirectories (`rules/`, `commands/`, …) and single-file features
   * (`mcp.jsonc`, `hooks.jsonc`, …). Later entries take precedence in
   * per-feature merges. Defaults to `[join(process.cwd(), ".rulesync")]`.
   *
   * The singular user-facing alias (`inputRoot` in `rulesync.jsonc` / the
   * `--input-root` CLI flag / `GenerateOptions.inputRoot`) is deprecated
   * and collapsed into `[join(inputRoot, ".rulesync")]` before it ever
   * reaches a processor — every internal consumer only ever sees the
   * plural form, with the source tree already resolved.
   */
  protected readonly inputRoots: readonly [string, ...string[]];
  protected readonly dryRun: boolean;
  protected readonly logger: Logger;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    dryRun?: boolean;
    logger: Logger;
  }) {
    this.outputRoot = outputRoot;

    this.inputRoots =
      inputRoots !== undefined && inputRoots.length > 0
        ? [inputRoots[0]!, ...inputRoots.slice(1)]
        : [join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)];

    this.dryRun = dryRun;
    this.logger = logger;
  }

  abstract loadRulesyncFiles(): Promise<RulesyncFile[]>;

  abstract loadToolFiles(params?: { forDeletion?: boolean }): Promise<ToolFile[]>;

  abstract convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]>;

  abstract convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]>;

  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(
    _params: { global?: boolean; includeSimulated?: boolean } = {},
  ): ToolTarget[] {
    throw new Error("Not implemented");
  }

  /**
   * Once converted to rulesync/tool files, write them to the filesystem.
   * Returns the count and paths of files written.
   */
  async writeAiFiles(aiFiles: AiFile[]): Promise<WriteResult> {
    let changedCount = 0;
    const changedPaths: string[] = [];
    for (const aiFile of aiFiles) {
      const filePath = aiFile.getFilePath();
      const existingFileContent = await readFileContentOrNull(filePath);

      if (existingFileContent !== null && aiFile.shouldMergeExistingFileContent()) {
        aiFile.setFileContent(existingFileContent);
      }

      const contentWithNewline = addTrailingNewline(aiFile.getFileContent());
      const existingContent = existingFileContent;

      // Never bring a shared, user-managed config file into existence just to
      // hold an empty payload — that is pure `git status` noise for paths
      // rulesync merges into but does not own. An existing file is still
      // rewritten, so user-authored content is never dropped.
      if (
        existingContent === null &&
        aiFile.shouldSkipCreationWhenPayloadEmpty() &&
        fileContentIsEmptyPayload({ filePath, content: contentWithNewline })
      ) {
        continue;
      }

      const fileMode = aiFile.getFileMode?.();

      if (
        fileContentsEquivalent({
          filePath,
          expected: contentWithNewline,
          existing: existingContent,
        })
      ) {
        // The content is already right, but the mode may not be: an interrupted
        // run (or a file the user copied in) can leave an executable output
        // without its executable bit, and the write that would have fixed it is
        // the one being skipped here. Only a *missing* executable bit is
        // restored, so a user who tightened the mode (0700) keeps it.
        if (fileMode !== undefined && !this.dryRun) {
          await restoreMissingExecutableBit(filePath, fileMode);
        }
        continue;
      }

      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would write: ${filePath}`);
      } else {
        await writeFileContent(filePath, contentWithNewline);
        if (fileMode !== undefined) {
          await applyFileMode(filePath, fileMode);
        }
      }
      changedCount++;
      changedPaths.push(aiFile.getRelativePathFromCwd());
    }

    return { count: changedCount, paths: changedPaths };
  }

  async removeAiFiles(aiFiles: AiFile[]): Promise<void> {
    for (const aiFile of aiFiles) {
      await removeFile(aiFile.getFilePath());
    }
  }

  /**
   * Remove orphan files that exist in the tool directory but not in the generated files.
   * This only deletes files that are no longer in the rulesync source, not files that will be overwritten.
   */
  async removeOrphanAiFiles(existingFiles: AiFile[], generatedFiles: AiFile[]): Promise<number> {
    const generatedPaths = new Set(generatedFiles.map((f) => f.getFilePath()));
    const orphanFiles = existingFiles.filter((f) => !generatedPaths.has(f.getFilePath()));

    for (const aiFile of orphanFiles) {
      const filePath = aiFile.getFilePath();
      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would delete: ${filePath}`);
      } else {
        await removeFile(filePath);
      }
    }

    return orphanFiles.length;
  }
}

/**
 * Return the last input root that contains any of the given `relativePaths`,
 * or `undefined` when none of the roots has any of them. Used by single-file
 * features (hooks, permissions, ignore) to implement the "later root wins
 * the whole file" merge policy without materializing the file contents.
 *
 * `relativePaths` accepts a small list so features that historically read
 * either a recommended path or a legacy alias (e.g. `.rulesync/mcp.jsonc`
 * plus `.rulesync/mcp.json`) can preserve that resolution order per root.
 * A root counts as "having" the file as long as at least one candidate path
 * is present.
 */
export async function pickLastRootWithFile({
  inputRoots,
  relativePaths,
}: {
  inputRoots: readonly string[];
  relativePaths: readonly string[];
}): Promise<string | undefined> {
  let winner: string | undefined;

  for (const root of inputRoots) {
    for (const relativePath of relativePaths) {
      if (await fileExists(join(root, relativePath))) {
        winner = root;
        break;
      }
    }
  }

  return winner;
}

/**
 * Merge per-root result lists into a single ordered list, keeping the
 * later root's entry when two roots produced an item with the same
 * identity. Identity is intentionally provided by the caller so
 * per-feature nuances (case-insensitive filesystems, directory names for
 * skills, server names for MCP) live next to the feature that owns them.
 *
 * The returned list preserves the FIRST appearance order of each identity —
 * items in the earliest root keep their position, but their content is
 * replaced by the last root that provided the same identity. This matches
 * the "overlay" mental model: an overlay changes content, not order.
 */
export function mergeByIdentity<T>({
  perRoot,
  identity,
}: {
  perRoot: readonly T[][];
  identity: (item: T) => string;
}): T[] {
  const order: string[] = [];
  const winnerByKey = new Map<string, T>();

  for (const rootItems of perRoot) {
    for (const item of rootItems) {
      const key = identity(item);

      if (!winnerByKey.has(key)) {
        order.push(key);
      }

      winnerByKey.set(key, item);
    }
  }

  return order.map((key) => winnerByKey.get(key)!);
}

/**
 * Merge artifacts whose filenames are case-insensitive identities, warning
 * when distinct spellings collapse to the same key. Exact-name overlays are
 * intentional and remain quiet; only case-only ambiguity is diagnosed.
 */
export function mergeByCaseInsensitiveIdentity<T>({
  perRoot,
  identity,
  artifactName,
  logger,
}: {
  perRoot: readonly T[][];
  identity: (item: T) => string;
  artifactName: string;
  logger: Logger;
}): T[] {
  const spellingByKey = new Map<string, string>();
  const warnedKeys = new Set<string>();

  return mergeByIdentity({
    perRoot,
    identity: (item) => {
      const spelling = identity(item);
      const key = spelling.toLowerCase();
      const previousSpelling = spellingByKey.get(key);

      if (previousSpelling !== undefined && previousSpelling !== spelling && !warnedKeys.has(key)) {
        logger.warn(
          `Case-insensitive ${artifactName} collision: '${previousSpelling}' and '${spelling}' resolve to the same identity. The later entry wins.`,
        );
        warnedKeys.add(key);
      }

      if (previousSpelling === undefined) {
        spellingByKey.set(key, spelling);
      }

      return key;
    },
  });
}
