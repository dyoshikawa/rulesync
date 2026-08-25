import { join } from "node:path";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { fileContentIsEmptyPayload, fileContentsEquivalent } from "../utils/content-equivalence.js";
import { stripControlCharacters } from "../utils/control-characters.js";
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
/**
 * Messages already reported for a given logger.
 *
 * One `generate` run constructs a single-file processor per tool target and
 * per output root — more than twenty times for `--targets "*"` — and each one
 * re-resolves the same roots. Keying on the logger, which is created once per
 * run (and once per test), keeps the shadowing warning to a single line per
 * run instead of repeating it for every target.
 */
const warnedRootShadowingByLogger = new WeakMap<Logger, Set<string>>();

export async function pickLastRootWithFile({
  inputRoots,
  relativePaths,
  logger,
  artifactName,
}: {
  inputRoots: readonly string[];
  relativePaths: readonly string[];
  logger: Logger;
  // Named so the log line below points at the artifact the user recognizes
  // (e.g. "The permissions file") instead of an anonymous "This file".
  artifactName: string;
}): Promise<string | undefined> {
  let winner: string | undefined;
  const rootsWithFile: string[] = [];

  for (const root of inputRoots) {
    for (const relativePath of relativePaths) {
      if (await fileExists(join(root, relativePath))) {
        winner = root;
        rootsWithFile.push(root);
        break;
      }
    }
  }

  // Replacing the whole file is the documented policy for single-file
  // features, but doing it silently makes an overlay look like it merged with
  // the base file. Name the roots that lost so the dropped content is
  // traceable. This is a warning rather than progress output because the
  // affected files (ignore, permissions, hooks) gate what an agent may read
  // and run, so a whole-file replacement is worth noticing.
  if (rootsWithFile.length > 1 && winner !== undefined) {
    const shadowed = rootsWithFile.slice(0, -1);

    // Input roots come from a config file that can be checked into a
    // repository, so they are sanitized before reaching the terminal.
    const message = `${artifactName} is provided by more than one input root; '${stripControlCharacters(winner)}' replaces the whole file from ${shadowed.map((root) => `'${stripControlCharacters(root)}'`).join(", ")}.`;
    let warnedMessages = warnedRootShadowingByLogger.get(logger);

    if (warnedMessages === undefined) {
      warnedMessages = new Set<string>();
      warnedRootShadowingByLogger.set(logger, warnedMessages);
    }

    if (!warnedMessages.has(message)) {
      warnedMessages.add(message);
      logger.warn(message);
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
 * The key two spellings share when a case-insensitive filesystem would give
 * them one file. `toLowerCase()` is locale-independent (unlike
 * `toLocaleLowerCase`, it does not turn `I` into the Turkish `ı` under a Turkish
 * locale), and the NFC pass folds the composed and decomposed spellings of an
 * accented name — which macOS also resolves to a single directory —
 * onto each other.
 *
 * This is simple lowercasing rather than full Unicode case folding, so it is
 * deliberately narrower than what a filesystem considers one file: a Greek
 * final sigma, a Turkish `ı` under NTFS's upcasing, and a Win32 name whose
 * trailing dot is stripped all still produce distinct keys. Those pairs keep
 * the pre-existing behavior (both are imported, and the later one wins on the
 * filesystem); folding them here would instead drop names that a
 * case-sensitive filesystem keeps genuinely apart.
 */
export function caseFoldIdentity(identity: string): string {
  return identity.normalize("NFC").toLowerCase();
}

/**
 * Group spellings by their case-folded identity, keeping every original
 * spelling. On a case-sensitive filesystem one identity can cover several
 * spellings at once, and the caller needs them all to describe a collision
 * accurately.
 */
export function groupSpellingsByCaseFoldedIdentity(
  spellings: readonly string[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const spelling of spellings) {
    const identity = caseFoldIdentity(spelling);
    const existing = grouped.get(identity);

    if (existing === undefined) {
      grouped.set(identity, [spelling]);
    } else {
      existing.push(spelling);
    }
  }

  return grouped;
}

/**
 * Build the warning emitted when a `.curated/` entry and a local entry in the
 * same tree differ only in case.
 *
 * `.curated/` is expanded from a declarative source (an external Git repository
 * or npm package), so its names are untrusted input; both sides are stripped of
 * control characters before they reach the terminal.
 *
 * The winning local spelling is the LAST one, matching the precedence
 * {@link mergeByCaseInsensitiveIdentity} applies afterwards; any other spelling
 * that folds onto the same identity is listed too, so the message never names a
 * spelling that loses.
 */
export function formatCuratedCaseCollisionWarning({
  artifactKind,
  entryNoun,
  treeDirPath,
  curatedSpelling,
  localSpellings,
}: {
  artifactKind: string;
  entryNoun: string;
  treeDirPath: string;
  curatedSpelling: string;
  localSpellings: readonly string[];
}): string {
  const winner = localSpellings[localSpellings.length - 1] ?? "";
  const shadowed = localSpellings.slice(0, -1);
  const shadowedSuffix =
    shadowed.length === 0
      ? ""
      : ` Other local spellings that fold onto the same identity: ${shadowed
          .map((spelling) => `'${stripControlCharacters(spelling)}'`)
          .join(", ")}.`;

  return (
    `Case-insensitive ${artifactKind} collision under ${treeDirPath}: ` +
    `curated '${stripControlCharacters(curatedSpelling)}' and local '${stripControlCharacters(winner)}' ` +
    `resolve to the same identity. The local ${entryNoun} wins and the curated ${entryNoun} is skipped.` +
    shadowedSuffix
  );
}

/**
 * Merge artifacts whose filenames are case-insensitive identities, warning
 * when distinct spellings collapse to the same key. Exact-name overlays are
 * intentional and remain quiet; only case-only ambiguity is diagnosed.
 *
 * Precedence here is the opposite of {@link ClaimedIdentities}: this merges
 * overlay roots, where the LAST entry wins, while the tool-side loaders keep
 * the FIRST root to claim a name.
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
      const key = caseFoldIdentity(spelling);
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

/**
 * A claim an earlier scan already holds on an identity: the spelling it used,
 * and the caller-supplied label for where it came from.
 */
export type ClaimedIdentity = {
  /**
   * Equal to the identity being claimed for a plain duplicate, and differing
   * from it for a case-only collision, so callers can word the two apart.
   */
  spelling: string;
  /**
   * Whatever the first claimer passed as `source` — a discovery root for the
   * tool-side loaders. Comparing it against the current source separates a
   * collision across roots from one inside a single root, so the same
   * "a higher-precedence root wins" sentence is not used for both.
   */
  source: string;
};

/**
 * Tracks the import identities already claimed while scanning, folding case
 * through {@link caseFoldIdentity}.
 *
 * The tool-side loaders scan several roots in precedence order and keep the
 * first spelling of each identity. Comparing those identities exactly lets
 * `.junie/skills/dup-skill` and `.agents/skills/Dup-Skill` both through, and
 * since macOS and Windows resolve the two written-back directories to a
 * single one, the shared Agent Skills copy lands last and overwrites the
 * tool-specific one — inverting the precedence the roots were ordered by.
 *
 * The FIRST claimer wins, which is the opposite of the overlay precedence in
 * {@link mergeByCaseInsensitiveIdentity}: roots are passed in precedence
 * order, so the earliest one to name a skill is the one that should keep it.
 */
export class ClaimedIdentities {
  private readonly claimByKey = new Map<string, ClaimedIdentity>();

  /**
   * Claim `identity` on behalf of `source`. Returns `null` when nothing held
   * it yet, or the standing claim when something did.
   */
  claim({ identity, source }: { identity: string; source: string }): ClaimedIdentity | null {
    const key = caseFoldIdentity(identity);
    const claimed = this.claimByKey.get(key);
    if (claimed !== undefined) {
      return claimed;
    }
    this.claimByKey.set(key, { spelling: identity, source });
    return null;
  }
}
