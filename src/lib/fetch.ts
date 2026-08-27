import { lstat, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_HOOKS_LEGACY_FILE_NAME,
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_LEGACY_FILE_NAME,
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_LEGACY_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { Feature } from "../types/features.js";
import { ALL_FEATURES } from "../types/features.js";
import type { FetchTarget } from "../types/fetch-targets.js";
import type {
  ConflictStrategy,
  FetchFileResult,
  FetchOptions,
  FetchSummary,
  GitHubFileEntry,
  ParsedSource,
} from "../types/fetch.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  createTempDirectory,
  fileExists,
  isFileNotFoundError,
  removeTempDirectory,
  toPosixPath,
  writeFileContent,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError } from "./github-client.js";
import { listDirectoryRecursive, MAX_RECURSION_DEPTH, withSemaphore } from "./github-utils.js";
import { isInteractiveTerminal, promptSkillSelection } from "./skill-prompt.js";
import { parseSource } from "./source-parser.js";

/**
 * Feature to path mapping for filtering (rulesync format)
 */
const FEATURE_PATHS: Record<Feature, string[]> = {
  rules: ["rules"],
  commands: ["commands"],
  subagents: ["subagents"],
  skills: ["skills"],
  checks: ["checks"],
  ignore: [RULESYNC_AIIGNORE_FILE_NAME],
  mcp: [RULESYNC_MCP_FILE_NAME, RULESYNC_MCP_LEGACY_FILE_NAME],
  hooks: [RULESYNC_HOOKS_FILE_NAME, RULESYNC_HOOKS_LEGACY_FILE_NAME],
  permissions: [RULESYNC_PERMISSIONS_FILE_NAME, RULESYNC_PERMISSIONS_LEGACY_FILE_NAME],
};

/**
 * Check if target is a tool target (not rulesync)
 */
function isToolTarget(target: FetchTarget): target is ToolTarget {
  return target !== "rulesync";
}

/**
 * Validate file size against maximum limit
 * @throws {GitHubClientError} If file size exceeds limit
 */
function validateFileSize(relativePath: string, size: number): void {
  if (size > MAX_FILE_SIZE) {
    throw new GitHubClientError(
      `File "${relativePath}" exceeds maximum size limit (${(size / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    );
  }
}

/**
 * Result of feature conversion
 */
type FeatureConversionResult = {
  converted: number;
  convertedPaths: string[];
};

/**
 * Processor type for feature conversion
 */
type FeatureProcessor = {
  loadToolFiles(): Promise<unknown[]>;
  convertToolFilesToRulesyncFiles(
    toolFiles: unknown[],
  ): Promise<
    Array<{ getRelativeDirPath(): string; getRelativeFilePath(): string; getFileContent(): string }>
  >;
};

/**
 * Process feature conversion for a single feature type
 * @param processor - The processor to use for loading and converting files
 * @param outputDir - Output directory for converted files
 * @returns The paths of converted files
 */
async function processFeatureConversion(params: {
  processor: FeatureProcessor;
  outputDir: string;
}): Promise<{ paths: string[] }> {
  const { processor, outputDir } = params;
  const paths: string[] = [];

  const toolFiles = await processor.loadToolFiles();
  if (toolFiles.length === 0) {
    return { paths: [] };
  }

  const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
  for (const file of rulesyncFiles) {
    const relativePath = join(file.getRelativeDirPath(), file.getRelativeFilePath());
    const outputPath = join(outputDir, relativePath);
    await writeFileContent(outputPath, file.getFileContent());
    paths.push(relativePath);
  }

  return { paths };
}

/**
 * Convert fetched tool-specific files to rulesync format
 * @param tempDir - Temporary directory containing tool-specific files
 * @param outputDir - Output directory for rulesync files
 * @param target - Tool target to convert from
 * @param features - Features to convert
 * @returns Number of converted files and their paths
 */
async function convertFetchedFilesToRulesync(params: {
  tempDir: string;
  outputDir: string;
  target: ToolTarget;
  features: Feature[];
  logger: Logger;
}): Promise<FeatureConversionResult> {
  const { tempDir, outputDir, target, features, logger } = params;
  const convertedPaths: string[] = [];

  // Feature conversion configurations
  // Each config defines how to get supported targets and create a processor
  const featureConfigs: Array<{
    feature: Feature;
    getTargets: () => ToolTarget[];
    createProcessor: () => FeatureProcessor;
  }> = [
    {
      feature: "rules",
      getTargets: () => RulesProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new RulesProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
    {
      feature: "commands",
      getTargets: () =>
        CommandsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () =>
        new CommandsProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
    {
      feature: "subagents",
      getTargets: () =>
        SubagentsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () =>
        new SubagentsProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
    {
      feature: "checks",
      getTargets: () => ChecksProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new ChecksProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
    {
      feature: "ignore",
      getTargets: () => IgnoreProcessor.getToolTargets(),
      createProcessor: () =>
        new IgnoreProcessor({ outputRoot: tempDir, toolTarget: target, logger }),
    },
    {
      feature: "mcp",
      getTargets: () => McpProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new McpProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
    {
      feature: "hooks",
      getTargets: () => HooksProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new HooksProcessor({ outputRoot: tempDir, toolTarget: target, global: false, logger }),
    },
  ];

  // Process each feature using data-driven approach
  for (const config of featureConfigs) {
    if (!features.includes(config.feature)) {
      continue;
    }
    const supportedTargets = config.getTargets();
    if (!supportedTargets.includes(target)) {
      continue;
    }
    const processor = config.createProcessor();
    const result = await processFeatureConversion({ processor, outputDir });
    convertedPaths.push(...result.paths);
  }

  // Skills conversion is not yet supported in fetch command
  // Note: Skills are more complex as they are directory-based.
  // Users can use the import command for skills conversion.
  if (features.includes("skills")) {
    logger.debug(
      "Skills conversion is not yet supported in fetch command. Use import command instead.",
    );
  }

  return { converted: convertedPaths.length, convertedPaths };
}

/**
 * Resolve features from options, defaulting to skills and handling wildcard.
 */
function resolveFeatures(features?: string[]): Feature[] {
  if (features === undefined) {
    return ["skills"];
  }
  if (features.includes("*")) {
    return [...ALL_FEATURES];
  }
  return features.filter((f): f is Feature => ALL_FEATURES.includes(f as Feature));
}

/**
 * A file entry collected from feature directories
 */
type CollectedFile = {
  remotePath: string;
  relativePath: string;
  size: number;
};

/**
 * Everything one collection pass learned about the remote: the files it found,
 * and the directories it could not enumerate in full.
 */
type CollectedFeatureFiles = {
  files: CollectedFile[];
  incompleteRemoteDirs: Set<string>;
};

/**
 * How a collected file relates to the skills directory.
 *
 * - `non-skill` — outside skills/, or a flat file directly under it. Skills are
 *   directory-based (skills/<name>/SKILL.md), so such a file belongs to no
 *   skill and selection does not apply to it.
 * - `unsafe-name` — under a skills/ directory whose name does not survive
 *   control-character stripping. It cannot be offered honestly, so it is never
 *   selectable.
 * - `skill` — belongs to the named skill.
 */
type SkillPathClass =
  | { kind: "non-skill" }
  | { kind: "unsafe-name"; raw: string; display: string }
  | { kind: "skill"; name: string };

const NON_SKILL_PATH: SkillPathClass = { kind: "non-skill" };

/**
 * Classify a collected file's path relative to the skills directory.
 *
 * A directory name is only usable when it is already free of control
 * characters. Stripping them for display and then matching on the stripped
 * form would let a remote repository publish `skills/<U+200E>/` — invisible in
 * the prompt — or `skills/go<U+200E>od/`, which displays as an existing skill
 * and would ride along with it. Names like that are reported as `unsafe-name`
 * so callers can leave them out instead of writing a skill the user never saw.
 */
function classifySkillPath(relativePath: string): SkillPathClass {
  // Split on "/" alone. A remote path is POSIX, so a backslash in one is an
  // ordinary character in a name, and normalizing it to a separator first would
  // read `skills/other\evil/SKILL.md` as the skill `other` — handing the prune
  // below a directory this run never wrote.
  if (!relativePath.startsWith("skills/")) {
    return NON_SKILL_PATH;
  }
  const segments = relativePath.split("/");
  if (segments.length < 3) {
    return NON_SKILL_PATH;
  }
  const name = segments[1];
  if (name === undefined || name === "") {
    return NON_SKILL_PATH;
  }
  // Not one usable directory entry, so it names no skill and, above all, hands
  // the prune no directory to walk. Collection already turns such a path away
  // before it gets here; this keeps the function safe read on its own.
  if (name === "." || name === ".." || name.includes("\\")) {
    return NON_SKILL_PATH;
  }
  const display = stripControlCharacters(name);
  if (display !== name) {
    return { kind: "unsafe-name", raw: name, display };
  }
  return { kind: "skill", name };
}

/**
 * Refuse a remote path that walks out of where it is being written.
 *
 * A repository cannot hold a `.` or `..` path component, so a path carrying one
 * did not come from the repository's own tree and nothing legitimate is turned
 * away — while what it would decide is where a file lands, and above all what
 * the skill prune deletes: `skills/./SKILL.md` reads back as the skill `.`,
 * whose directory is the whole of `skills/`.
 */
function validateRemoteRelativePath(relativePath: string): void {
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(
      `Unsafe path in the remote repository: ${JSON.stringify(relativePath)}. A fetched path ` +
        `must be a plain POSIX path, without "." and ".." segments.`,
    );
  }
}

/**
 * Keep only the files whose remote path means one local path.
 *
 * A remote path is POSIX, so a backslash in one is an ordinary character in a
 * name — but the local side is not always POSIX, and every layer below reads
 * such a name differently: `skills/a\b/SKILL.md` is one file in a directory
 * named `a\b` here and two directories deep on Windows, and the prune would be
 * handed a directory this run never wrote. A name nobody agrees on is worth far
 * less than the rest of the fetch, so the file is dropped and the run goes on.
 */
function dropAmbiguousRemotePaths(params: {
  files: CollectedFile[];
  incompleteRemoteDirs: Set<string>;
  logger: Logger;
}): CollectedFile[] {
  const { files, incompleteRemoteDirs, logger } = params;
  const kept: CollectedFile[] = [];
  for (const file of files) {
    if (toPosixPath(file.relativePath) === file.relativePath) {
      kept.push(file);
      continue;
    }
    // Dropping the file makes the fetched list smaller than the remote
    // directory it came from, and a prune reads that list as the whole of the
    // remote skill. The directory is recorded as incomplete for exactly the
    // reason a truncated listing is: a local file the remote still ships is no
    // longer distinguishable from one it dropped.
    incompleteRemoteDirs.add(posix.dirname(toPosixPath(file.remotePath)));
    logger.warn(
      `Skipping ${JSON.stringify(file.remotePath)}: its path contains a backslash, which names ` +
        `one file on some systems and a directory on others.`,
    );
  }
  return kept;
}

/**
 * List unique skill names among collected files
 */
function listAvailableSkills(files: CollectedFile[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    const skill = classifySkillPath(file.relativePath);
    if (skill.kind === "skill") {
      names.add(skill.name);
    }
  }
  return [...names].toSorted();
}

/**
 * Validate the combination of skill selection options before any network call.
 * Fails fast when the skills feature is disabled or when --interactive cannot
 * show a prompt (no TTY).
 */
function validateSkillSelectionOptions(params: {
  requestedSkills: string[];
  interactive: boolean;
  enabledFeatures: Feature[];
}): void {
  const { requestedSkills, interactive, enabledFeatures } = params;

  if ((requestedSkills.length > 0 || interactive) && !enabledFeatures.includes("skills")) {
    throw new Error(
      "The --skills and --interactive options require the skills feature. " +
        "Add 'skills' to --features or omit --features to use the default.",
    );
  }

  if (interactive && !isInteractiveTerminal()) {
    throw new Error(
      "The --interactive option requires an interactive terminal (TTY). " +
        "Use --skills <names> to select skills non-interactively.",
    );
  }
}

/**
 * Narrow collected skill files to a selection, either from the --skills option
 * or via an interactive checkbox prompt (--interactive).
 * Files outside the skills directory pass through untouched.
 */
async function applySkillSelection(params: {
  files: CollectedFile[];
  requestedSkills: string[];
  interactive: boolean;
  logger: Logger;
}): Promise<CollectedFile[]> {
  const { files, requestedSkills, interactive, logger } = params;

  if (requestedSkills.length === 0 && !interactive) {
    return files;
  }

  const availableSkills = listAvailableSkills(files);

  if (requestedSkills.length > 0) {
    const unknownSkills = requestedSkills.filter((name) => !availableSkills.includes(name));
    if (unknownSkills.length > 0) {
      const availableText =
        availableSkills.length > 0 ? availableSkills.join(", ") : "(no skills found)";
      throw new Error(
        `Unknown skill(s): ${unknownSkills.join(", ")}. Available skills: ${availableText}`,
      );
    }
  }

  let selectedSkills = requestedSkills;
  if (interactive) {
    if (availableSkills.length === 0) {
      logger.warn("No skills found in the source repository to select from.");
      selectedSkills = [];
    } else {
      selectedSkills = await promptSkillSelection({
        availableSkills,
        preselectedSkills: requestedSkills,
      });
      if (selectedSkills.length === 0) {
        logger.warn("No skills were selected in the interactive prompt; skipping all skills.");
      }
    }
  }

  const selectedSet = new Set(selectedSkills);
  const droppedUnsafeNames = new Map<string, string>();
  const selected = files.filter((file) => {
    const skill = classifySkillPath(file.relativePath);
    if (skill.kind === "non-skill") {
      return true;
    }
    // A name the prompt could not show truthfully was never on offer, so it
    // cannot have been selected. Dropping it keeps the guarantee the selection
    // makes: only skills the user saw and picked are written.
    if (skill.kind === "unsafe-name") {
      // Keyed by the raw name so two directories that both strip down to
      // nothing still count as two.
      droppedUnsafeNames.set(skill.raw, skill.display);
      return false;
    }
    return selectedSet.has(skill.name);
  });

  if (droppedUnsafeNames.size > 0) {
    logger.warn(formatDroppedSkillsWarning(droppedUnsafeNames));
  }

  return selected;
}

/**
 * Describe the skill directories dropped for having control characters in their
 * name, keyed raw name to stripped name.
 *
 * The stripped form is all there is to show — the raw name is unprintable, which
 * is the whole reason the directory was dropped — and it can be empty or read
 * exactly like a skill the user did fetch. So a name that survives stripping is
 * quoted, to mark it as the sanitized form rather than a claim about what was
 * skipped, and a name that does not survive is counted instead of printed.
 */
function formatDroppedSkillsWarning(droppedUnsafeNames: ReadonlyMap<string, string>): string {
  const displays = [...droppedUnsafeNames.values()];
  // Deduplicated, because two raw names can strip down to the same text and
  // listing it twice reads as a rendering bug. The count above stays keyed on
  // the raw names, so it still says how many directories were dropped.
  const shown = [...new Set(displays.filter((display) => display !== ""))]
    .toSorted()
    .map((display) => JSON.stringify(display))
    .join(", ");
  const unprintable = displays.filter((display) => display === "").length;

  const plural = droppedUnsafeNames.size !== 1;
  const lead =
    `Skipping ${plural ? `${droppedUnsafeNames.size} skill directories whose names contain` : "one skill directory whose name contains"} ` +
    `control characters. Such a name cannot be listed truthfully, so it is never offered for ` +
    `selection.`;

  if (shown === "") {
    return (
      `${lead} Nothing is left of ${plural ? "those names" : "the name"} once the control ` +
      `characters are removed, so there is nothing to show here.`
    );
  }

  return (
    `${lead} Shown here with the control characters removed, which is why a name may look ` +
    `like one you did select: ${shown}` +
    `${unprintable > 0 ? `, plus ${unprintable} with nothing left once they are removed` : ""}.`
  );
}

/**
 * Whether the set holds `root` itself or anything beneath it. Both sides are
 * POSIX paths, so a plain prefix comparison is enough.
 */
function hasPathAtOrUnder(paths: ReadonlySet<string>, root: string): boolean {
  if (paths.has(root)) {
    return true;
  }
  const prefix = `${root}/`;
  for (const path of paths) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Identify a local path by the file it actually is, rather than by the name it
 * is reached through.
 *
 * The names in the fetched list are the remote spellings, and the local
 * filesystem may hold the same file under a different one: macOS stores a name
 * in NFD and answers to NFC, and it — like Windows — treats two spellings that
 * differ only in case as one file. Writing the remote `Scripts/Ref.md` onto a
 * local `scripts/ref.md` updates that one file and leaves both names as they
 * were, so going by name alone would delete what this run just fetched.
 *
 * `undefined` for a path that is not there, or that cannot be stat'ed.
 */
async function fileIdentity(
  path: string,
  options?: { follow?: boolean },
): Promise<string | undefined> {
  const read = options?.follow === true ? stat : lstat;
  const stats = await read(path).catch((error: unknown) => {
    // A path that is not there, and a link that leads nowhere or back to
    // itself, have no identity to compare — that is an answer. A permission or
    // I/O error is not: reporting it as "no identity" would send a file this
    // run just fetched to be deleted, so it is raised instead.
    if (isFileNotFoundError(error) || isSymbolicLinkLoopError(error)) {
      return undefined;
    }
    throw error;
  });
  return stats === undefined ? undefined : `${stats.dev}:${stats.ino}`;
}

/**
 * The identity of everything this run wrote inside a skill directory — each
 * file, and each directory on the way to it — as the filesystem sees it.
 *
 * Links are followed, so a path written through a symbolic link is recorded as
 * what the write actually landed on, which is what the prune finds when it
 * follows the same link. The directories are in here for the links among them:
 * a link standing in for a directory the fetch wrote through has the identity
 * of the directory it points at, and nothing else would recognize it.
 *
 * Only skill paths are looked at. They are the only ones a prune ever weighs,
 * and the rest of a fetch can be thousands of files.
 */
async function collectFetchedIds(params: {
  outputBasePath: string;
  fetchedFiles: CollectedFile[];
}): Promise<Set<string>> {
  const { outputBasePath, fetchedFiles } = params;

  const paths = new Set<string>();
  for (const file of fetchedFiles) {
    const relativePath = toPosixPath(file.relativePath);
    if (classifySkillPath(relativePath).kind !== "skill") {
      continue;
    }
    // Up to but not into `skills/`, which is shared by every skill and is not
    // something this run can claim to have written.
    for (
      let current = relativePath;
      current.split("/").length > 2;
      current = posix.dirname(current)
    ) {
      paths.add(current);
    }
  }

  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const ids = await Promise.all(
    [...paths].map((relativePath) =>
      withSemaphore(semaphore, () =>
        fileIdentity(join(outputBasePath, relativePath), { follow: true }),
      ),
    ),
  );
  return new Set(ids.filter((id) => id !== undefined));
}

/**
 * Whether the link is one the fetch wrote through, and so has to be left
 * exactly as it is — including anything stale behind it, since its target is
 * somewhere this prune has no business walking.
 *
 * It counts as written through when the write resolved to what stands behind
 * it, which is a file for a link to a file and a directory for a link standing
 * in for one, or when the fetched list names the link itself or something under
 * it.
 */
async function isFetchedSymbolicLink(params: {
  entryPath: string;
  entryRelativePath: string;
  fetchedPaths: ReadonlySet<string>;
  fetchedIds: ReadonlySet<string>;
}): Promise<boolean> {
  const { entryPath, entryRelativePath, fetchedPaths, fetchedIds } = params;
  const targetId = await fileIdentity(entryPath, { follow: true });
  return (
    (targetId !== undefined && fetchedIds.has(targetId)) ||
    hasPathAtOrUnder(fetchedPaths, entryRelativePath)
  );
}

/**
 * What a prune pass left behind in one directory.
 *
 * `missing` and `emptied` are kept apart so the caller only removes a directory
 * it has just emptied itself, and never one that disappeared underneath the
 * walk.
 */
type PruneOutcome = "missing" | "kept" | "emptied";

/**
 * Walk one directory, deleting every entry the remote no longer has.
 *
 * Returns whether anything survived, so the caller can drop a directory that
 * pruning emptied.
 */
async function pruneDirectory(params: {
  outputBasePath: string;
  relativeDirPath: string;
  fetchedPaths: ReadonlySet<string>;
  fetchedIds: ReadonlySet<string>;
  deleted: FetchFileResult[];
  depth?: number;
  logger: Logger;
}): Promise<PruneOutcome> {
  const {
    outputBasePath,
    relativeDirPath,
    fetchedPaths,
    fetchedIds,
    deleted,
    depth = 0,
    logger,
  } = params;
  const dirPath = join(outputBasePath, relativeDirPath);

  if (depth > MAX_RECURSION_DEPTH) {
    // A local walk needs a ceiling of its own, and this is the remote walk's
    // number reused rather than a second one to keep in step. The two count
    // from different roots, so it is not the same ceiling — only one deep
    // enough that a fetched tree stays well inside it, since the remote walk
    // fails outright rather than truncating when it runs past its own.
    logger.warn(
      `Not pruning below ${stripControlCharacters(relativeDirPath)}: it is more than ` +
        `${MAX_RECURSION_DEPTH} directories deep.`,
    );
    return "kept";
  }

  // `readdir` resolves the path it is handed, unlike the entries it reports, so
  // a directory that is a symbolic link would have this walk deleting files
  // wherever the link points. The entry loop below already refuses to descend
  // into one; this catches the skill directory the walk starts at, and a
  // directory swapped for a link between the two reads.
  if (await isSymbolicLink(dirPath)) {
    logger.warn(
      `Not pruning ${stripControlCharacters(relativeDirPath)}: it is a symbolic link, and its ` +
        `target is outside what this fetch may delete from. Remove unwanted files by hand.`,
    );
    return "kept";
  }

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    // Nothing local under this skill yet — every file was created a moment ago,
    // so there is nothing that could have gone stale.
    if (isFileNotFoundError(error)) {
      return "missing";
    }
    throw error;
  }

  let survivors = 0;

  for (const entry of entries) {
    const entryRelativePath = posix.join(relativeDirPath, entry.name);
    const entryPath = join(dirPath, entry.name);

    // `readdir` reports link entries as links rather than as what they point
    // at, so a symbolic link here is unlinked, never walked and never resolved:
    // one aimed outside the output directory can only ever lose the link.
    if (entry.isSymbolicLink()) {
      if (await isFetchedSymbolicLink({ entryPath, entryRelativePath, fetchedPaths, fetchedIds })) {
        survivors++;
        continue;
      }
      await rm(entryPath, { force: true });
      deleted.push({ relativePath: entryRelativePath, status: "deleted" });
      logger.debug(`Deleted stale skill entry: ${stripControlCharacters(entryRelativePath)}`);
      continue;
    }

    if (entry.isDirectory()) {
      const outcome = await pruneDirectory({
        outputBasePath,
        relativeDirPath: entryRelativePath,
        fetchedPaths,
        fetchedIds,
        deleted,
        depth: depth + 1,
        logger,
      });
      if (outcome === "kept") {
        survivors++;
        continue;
      }
      if (outcome === "missing") {
        // It vanished between the two reads. Nothing is left to remove, and
        // nothing was removed here, so it is not reported either.
        continue;
      }
      // The remote skill has no directory here any more, so the directory goes
      // too. It is reported under its own name, with a trailing slash, because
      // removing it deletes a local path in its own right.
      try {
        await rmdir(entryPath);
      } catch (error) {
        // Something appeared in it, or it went away, between emptying it and
        // removing it. Either way there is nothing here left to report.
        if (isFileNotFoundError(error) || isDirectoryNotEmptyError(error)) {
          survivors++;
          continue;
        }
        throw error;
      }
      deleted.push({ relativePath: `${entryRelativePath}/`, status: "deleted" });
      logger.debug(`Removed stale skill directory: ${stripControlCharacters(entryRelativePath)}`);
      continue;
    }

    // The name is checked first because it settles the ordinary case without
    // touching the disk; identity covers the spellings the filesystem keeps to
    // itself, including the ones in the directory names on the way here.
    if (fetchedPaths.has(entryRelativePath)) {
      survivors++;
      continue;
    }

    const entryId = await fileIdentity(entryPath);
    if (entryId !== undefined && fetchedIds.has(entryId)) {
      survivors++;
      continue;
    }

    await rm(entryPath, { force: true });
    deleted.push({ relativePath: entryRelativePath, status: "deleted" });
    logger.debug(`Deleted stale skill file: ${stripControlCharacters(entryRelativePath)}`);
  }

  return survivors > 0 ? "kept" : "emptied";
}

/**
 * Run the skill prune when the options ask for it.
 *
 * `--conflict skip` says to leave existing local files alone, so pruning them
 * would contradict the flag the user just passed. It also skipped writing them,
 * which means the local copies are not this run's output and cannot be judged
 * against the remote list.
 */
async function maybePruneStaleSkillFiles(params: {
  prune: boolean;
  conflictStrategy: ConflictStrategy;
  outputBasePath: string;
  fetchedFiles: CollectedFile[];
  incompleteRemoteDirs: ReadonlySet<string>;
  logger: Logger;
}): Promise<FetchFileResult[]> {
  const { prune, conflictStrategy, outputBasePath, fetchedFiles, incompleteRemoteDirs, logger } =
    params;

  if (!prune) {
    logger.debug("Skipping the skill prune: --no-prune was given.");
    return [];
  }

  if (conflictStrategy === "skip") {
    logger.debug("Skipping the skill prune: --conflict skip keeps existing local files.");
    return [];
  }

  return pruneStaleSkillFiles({ outputBasePath, fetchedFiles, incompleteRemoteDirs, logger });
}

/**
 * The remote path of the skill directory a fetched file belongs to.
 *
 * A collected file's `relativePath` is its `remotePath` with the fetch's base
 * path cut off the front, so the base path is recovered by removing that suffix
 * and put back in front of the skill directory.
 *
 * `undefined` when the two paths do not line up that way after all. The result
 * is only ever used to look the directory up among the ones whose listing came
 * back incomplete, so a guess here would be a guess about whether deleting is
 * safe — and the caller answers that with "no".
 */
function remoteSkillDirPath(params: {
  file: CollectedFile;
  localSkillDir: string;
}): string | undefined {
  const { file, localSkillDir } = params;
  const remotePath = toPosixPath(file.remotePath);
  const relativePath = toPosixPath(file.relativePath);
  if (!remotePath.endsWith(relativePath)) {
    return undefined;
  }
  const basePrefix = remotePath.slice(0, remotePath.length - relativePath.length);
  return `${basePrefix}${localSkillDir}`;
}

/**
 * Delete local files inside the skill directories this run fetched that the
 * remote does not have.
 *
 * A skill is a directory, not a single file, so an additive fetch leaves a
 * mixture: the files upstream still ships, plus the ones it renamed or dropped.
 * Agents read whatever is in the directory, so an orphaned reference keeps
 * steering them long after upstream removed it — which is why the remote skill
 * is treated as the source of truth here.
 *
 * Only the `skills/<name>/` directories this run actually wrote are walked. A
 * skill left out by `--skills` or `--interactive`, the other features, and
 * everything else under the output directory are never touched.
 */
async function pruneStaleSkillFiles(params: {
  outputBasePath: string;
  fetchedFiles: CollectedFile[];
  incompleteRemoteDirs: ReadonlySet<string>;
  logger: Logger;
}): Promise<FetchFileResult[]> {
  const { outputBasePath, fetchedFiles, incompleteRemoteDirs, logger } = params;

  const fetchedPaths = new Set(fetchedFiles.map((file) => toPosixPath(file.relativePath)));
  const fetchedIds = await collectFetchedIds({ outputBasePath, fetchedFiles });
  // Local skill directory -> the remote directory it was fetched from, so an
  // incomplete listing can be matched back to the skill it would misjudge.
  // `undefined` where that directory could not be worked out.
  const skillDirs = new Map<string, string | undefined>();
  for (const file of fetchedFiles) {
    const skill = classifySkillPath(file.relativePath);
    if (skill.kind !== "skill") {
      continue;
    }
    const localSkillDir = `skills/${skill.name}`;
    if (!skillDirs.has(localSkillDir)) {
      skillDirs.set(localSkillDir, remoteSkillDirPath({ file, localSkillDir }));
    }
  }

  const deleted: FetchFileResult[] = [];
  for (const [skillDir, remoteDir] of [...skillDirs].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    // Deleting is only safe while the fetched file list is the whole remote
    // skill. Once GitHub has truncated a listing, or it held an entry kind the
    // walk cannot fetch, a local file that is still upstream is indistinguishable
    // from one upstream dropped — so nothing here is judged stale.
    if (remoteDir === undefined) {
      logger.warn(
        `Not pruning ${stripControlCharacters(skillDir)}: the remote directory it was fetched ` +
          `from could not be worked out, so there is nothing to judge the local files against. ` +
          `Remove unwanted files by hand.`,
      );
      continue;
    }

    if (hasPathAtOrUnder(incompleteRemoteDirs, remoteDir)) {
      logger.warn(
        `Not pruning ${stripControlCharacters(skillDir)}: the remote listing for it came back ` +
          `incomplete, so a stale local file cannot be told apart from one the listing left out. ` +
          `Remove unwanted files by hand.`,
      );
      continue;
    }

    // Windows drops a trailing dot or space when it resolves a path, so a
    // remote `skills/my-docs.` is the existing `skills/my-docs` there. The write
    // and the prune would agree with each other and disagree with the summary,
    // which would then name a directory other than the one it emptied. Nothing
    // reaches outside the output directory either way, but a deletion record
    // that names the wrong directory is not one worth keeping.
    // A name ending in the `NAME~1` shape is the same class of problem: on a
    // Windows volume that generates short names, it opens whatever long name it
    // stands for. The shape only means that at the end of a name, so `data~2parser`
    // is an ordinary name and is pruned. The guard is not gated on the platform:
    // the same repository is checked out on several of them, and a name that is
    // ambiguous on any one of them is one this tool would rather leave alone
    // everywhere than prune differently depending on where it runs.
    // Only the skill root is guarded. A remote `skills/a/bar./x.md` writes into
    // `bar` on Windows and the prune walks `bar`, which is safe because every
    // file the fetch wrote there is matched by identity rather than by name.
    if (/[.\s]$/.test(skillDir) || /~\d+(?:\.[^.]*)?$/.test(skillDir)) {
      logger.warn(
        `Not pruning ${stripControlCharacters(skillDir)}: its name is one some systems resolve ` +
          `to a different directory, so it may not be the directory this name reads as. Remove ` +
          `unwanted files by hand.`,
      );
      continue;
    }

    // A cheap re-assertion of the guard the writes went through: the directory
    // name comes from the remote repository. It is lexical only, which is why
    // the link check below has to follow it.
    checkPathTraversal({ relativePath: skillDir, intendedRootDir: outputBasePath });

    try {
      await pruneDirectory({
        outputBasePath,
        relativeDirPath: skillDir,
        fetchedPaths,
        fetchedIds,
        deleted,
        logger,
      });
    } catch (error) {
      // The files are already written; only the tidying up failed. A directory
      // this run cannot read or delete from — no permission to it, a disk that
      // gave out — costs this one skill its prune, and the run reports what it
      // could not do rather than throwing the fetch away over it. Only a
      // filesystem error is absorbed: anything else is a defect in the walk, and
      // one that turned into a warning would take a skipped prune with it
      // quietly. The message is stripped too, since a filesystem error carries
      // the local path it failed on.
      if (!isFileSystemError(error)) {
        throw error;
      }
      // "Stopped partway", not "did not prune": entries deleted before the
      // failure are already recorded, and the summary lists them.
      logger.warn(
        `Stopped partway through pruning ${stripControlCharacters(skillDir)}. ` +
          `${stripControlCharacters(formatError(error))}`,
      );
    }
  }

  if (deleted.length > 0) {
    // Every deletion is already listed in the summary, but the summary is a
    // wall of mostly-good news and this is the part that cannot be undone. It
    // also names the flag that turns it off, since the caller who is surprised
    // by it is exactly the caller who did not know there was one.
    logger.warn(
      `Deleted ${deleted.length} local ${deleted.length === 1 ? "path" : "paths"} inside the ` +
        `skill ${skillDirs.size === 1 ? "directory" : "directories"} this fetch wrote, because ` +
        `the remote skill no longer has ${deleted.length === 1 ? "it" : "them"}. They are listed ` +
        `in the summary below. Pass --no-prune to keep local files instead.`,
    );
  }

  return deleted;
}

/**
 * Whether the path could not be resolved because the links on the way to it
 * lead in a circle, or too far.
 */
function isSymbolicLinkLoopError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP";
}

/**
 * Whether removing the directory failed because something is still in it.
 */
/**
 * Whether the error came from the filesystem rather than from the walk itself.
 * Node stamps every `fs` rejection with a `code`, so its presence is what tells
 * an I/O failure apart from a programming error raised in the same call.
 */
function isFileSystemError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function isDirectoryNotEmptyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "EEXIST")
  );
}

/**
 * Whether the path is a symbolic link, without following it. A path that is not
 * there at all is not a link.
 */
async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Type guard for error objects with statusCode
 */
function hasStatusCode(error: unknown): error is { statusCode: number } {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  const maybeStatus = Object.getOwnPropertyDescriptor(error, "statusCode")?.value;
  return typeof maybeStatus === "number";
}

/**
 * Check if error is a 404 "not found" error
 */
function isNotFoundError(error: unknown): boolean {
  if (error instanceof GitHubClientError && error.statusCode === 404) {
    return true;
  }
  // Also handle plain objects with statusCode property (for test mocks)
  if (hasStatusCode(error) && error.statusCode === 404) {
    return true;
  }
  return false;
}

/**
 * A summary for a run that matched nothing, so had nothing to write or prune.
 */
function emptyFetchSummary(params: { source: string; ref: string }): FetchSummary {
  const { source, ref } = params;
  return { source, ref, files: [], created: 0, overwritten: 0, skipped: 0, deleted: 0 };
}

/**
 * Parameters for fetch operation
 */
export type FetchParams = {
  source: string;
  options?: FetchOptions;
  outputRoot?: string;
  logger: Logger;
};

/**
 * Fetch files from a Git repository
 * Searches for feature directories (rules/, commands/, skills/, etc.) directly at the specified path
 *
 * When target is "rulesync" (default), files are fetched as-is.
 * When target is a tool target (e.g., "claudecode"), files are fetched to a temp directory,
 * converted to rulesync format, and written to the output directory.
 */
export async function fetchFiles(params: FetchParams): Promise<FetchSummary> {
  const { source, options = {}, outputRoot = process.cwd(), logger } = params;

  // Parse source
  const parsed = parseSource(source);

  // Check if provider is supported
  if (parsed.provider === "gitlab") {
    throw new Error(
      "GitLab is not yet supported. Currently only GitHub repositories are supported.",
    );
  }

  // Resolve options
  const resolvedRef = options.ref ?? parsed.ref;
  // Normalize backslashes to forward slashes for GitHub API compatibility.
  const resolvedPath = toPosixPath(options.path ?? parsed.path ?? ".");
  const outputDir = options.output ?? RULESYNC_RELATIVE_DIR_PATH;
  const conflictStrategy: ConflictStrategy = options.conflict ?? "overwrite";
  const prune = options.prune ?? true;
  const enabledFeatures = resolveFeatures(options.features);
  const target: FetchTarget = options.target ?? "rulesync";
  const requestedSkills = options.skills ?? [];
  const interactive = options.interactive ?? false;

  validateSkillSelectionOptions({ requestedSkills, interactive, enabledFeatures });

  // Validate output directory to prevent path traversal attacks
  checkPathTraversal({
    relativePath: outputDir,
    intendedRootDir: outputRoot,
  });

  // Initialize GitHub client
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Validate repository
  logger.debug(`Validating repository: ${parsed.owner}/${parsed.repo}`);
  const isValid = await client.validateRepository(parsed.owner, parsed.repo);
  if (!isValid) {
    throw new GitHubClientError(
      `Repository not found: ${parsed.owner}/${parsed.repo}. Check the repository name and your access permissions.`,
      404,
    );
  }

  // Resolve ref to use
  const ref = resolvedRef ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
  logger.debug(`Using ref: ${ref}`);

  // If target is a tool format, use conversion flow
  if (isToolTarget(target)) {
    return fetchAndConvertToolFiles({
      client,
      parsed,
      ref,
      resolvedPath,
      enabledFeatures,
      requestedSkills,
      interactive,
      target,
      outputDir,
      outputRoot,
      conflictStrategy,
      logger,
    });
  }

  // Create semaphore for concurrency control
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  // Collect all files to fetch from feature directories directly
  const { files: collectedFiles, incompleteRemoteDirs } = await collectFeatureFiles({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    basePath: resolvedPath,
    ref,
    enabledFeatures,
    semaphore,
    logger,
  });

  const filesToFetch = await applySkillSelection({
    files: collectedFiles,
    requestedSkills,
    interactive,
    logger,
  });

  if (filesToFetch.length === 0) {
    logger.warn(`No files found matching enabled features: ${enabledFeatures.join(", ")}`);
    return emptyFetchSummary({ source: `${parsed.owner}/${parsed.repo}`, ref });
  }

  // Process files in parallel with concurrency control
  const outputBasePath = join(outputRoot, outputDir);

  // Validate paths and check file sizes first (synchronous checks)
  for (const { relativePath, size } of filesToFetch) {
    checkPathTraversal({
      relativePath,
      intendedRootDir: outputBasePath,
    });

    validateFileSize(relativePath, size);
  }

  // Process files in parallel with concurrency control
  // Note: Promise.all fails fast - if any promise rejects, others continue running but
  // may have already written files. This behavior is consistent with sequential execution,
  // but the window for partial writes is larger with parallel execution.
  const writeResults = await Promise.all(
    filesToFetch.map(async ({ remotePath, relativePath }) => {
      const localPath = join(outputBasePath, relativePath);
      const exists = await fileExists(localPath);

      if (exists && conflictStrategy === "skip") {
        logger.debug(`Skipping existing file: ${stripControlCharacters(relativePath)}`);
        return { relativePath, status: "skipped" as const };
      }

      const content = await withSemaphore(semaphore, () =>
        client.getFileContent(parsed.owner, parsed.repo, remotePath, ref),
      );
      await writeFileContent(localPath, content);

      const status = exists ? ("overwritten" as const) : ("created" as const);
      logger.debug(`Wrote: ${stripControlCharacters(relativePath)} (${status})`);
      return { relativePath, status };
    }),
  );

  const pruneResults = await maybePruneStaleSkillFiles({
    prune,
    conflictStrategy,
    outputBasePath,
    fetchedFiles: filesToFetch,
    incompleteRemoteDirs,
    logger,
  });

  const results = [...writeResults, ...pruneResults];

  // Calculate summary
  const summary: FetchSummary = {
    source: `${parsed.owner}/${parsed.repo}`,
    ref,
    files: results,
    created: results.filter((r) => r.status === "created").length,
    overwritten: results.filter((r) => r.status === "overwritten").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    deleted: results.filter((r) => r.status === "deleted").length,
  };

  return summary;
}

/**
 * Collect files from feature directories
 */
async function collectFeatureFiles(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  basePath: string;
  ref: string;
  enabledFeatures: Feature[];
  semaphore: Semaphore;
  logger: Logger;
}): Promise<CollectedFeatureFiles> {
  const { client, owner, repo, basePath, ref, enabledFeatures, semaphore, logger } = params;

  // Remote directories GitHub did not enumerate in full. Fetching is unaffected
  // — whatever was listed is still fetched — but pruning is not, so the paths
  // travel with the files.
  const incompleteRemoteDirs = new Set<string>();

  // Cache directory listing results to avoid duplicate API calls
  // File-based features (ignore, mcp, hooks) all list the same basePath directory
  const dirCache = new Map<string, Promise<GitHubFileEntry[]>>();

  async function getCachedDirectory(path: string): Promise<GitHubFileEntry[]> {
    let promise = dirCache.get(path);
    if (promise === undefined) {
      promise = withSemaphore(semaphore, () => client.listDirectory(owner, repo, path, ref));
      dirCache.set(path, promise);
    }
    return promise;
  }

  const tasks = enabledFeatures.flatMap((feature) =>
    FEATURE_PATHS[feature].map((featurePath) => ({ feature, featurePath })),
  );

  const results = await Promise.all(
    tasks.map(async ({ featurePath }) => {
      const fullPath =
        basePath === "." || basePath === "" ? featurePath : posix.join(basePath, featurePath);
      const collected: Array<{ remotePath: string; relativePath: string; size: number }> = [];

      try {
        // Check if it's a file (mcp.json, .aiignore, hooks.json)
        if (featurePath.includes(".")) {
          // Try to get the file directly
          try {
            const entries = await getCachedDirectory(
              basePath === "." || basePath === "" ? "." : basePath,
            );
            const fileEntry = entries.find((e) => e.name === featurePath && e.type === "file");
            if (fileEntry) {
              collected.push({
                remotePath: fileEntry.path,
                relativePath: featurePath,
                size: fileEntry.size,
              });
            }
          } catch (error) {
            // Only skip 404 errors (file not found), re-throw other errors
            if (isNotFoundError(error)) {
              logger.debug(`File not found: ${fullPath}`);
            } else {
              throw error;
            }
          }
        } else {
          // It's a directory (rules/, commands/, skills/, subagents/)
          const dirFiles = await listDirectoryRecursive({
            client,
            owner,
            repo,
            path: fullPath,
            ref,
            semaphore,
            onIncompleteDirectory: (remoteDirPath) => {
              incompleteRemoteDirs.add(remoteDirPath);
            },
          });

          for (const file of dirFiles) {
            // Calculate relative path from base. `posix.relative` rather than a
            // length-based cut, because the base path is whatever `--path` was
            // given — `./pkg` and `pkg/` both name the directory that
            // `posix.join` above normalized to `pkg`.
            const relativePath =
              basePath === "." || basePath === ""
                ? file.path
                : posix.relative(posix.normalize(basePath), file.path);

            collected.push({
              remotePath: file.path,
              relativePath,
              size: file.size,
            });
          }
        }
      } catch (error) {
        // Check for 404 errors (feature not found)
        if (isNotFoundError(error)) {
          // Feature directory/file not found, skip silently
          logger.debug(`Feature not found: ${fullPath}`);
          return collected;
        }
        throw error;
      }

      return collected;
    }),
  );

  const files = dropAmbiguousRemotePaths({
    files: results.flat(),
    incompleteRemoteDirs,
    logger,
  });
  for (const file of files) {
    validateRemoteRelativePath(file.relativePath);
  }

  return { files, incompleteRemoteDirs };
}

/**
 * Fetch tool-specific files and convert them to rulesync format
 */
async function fetchAndConvertToolFiles(params: {
  client: GitHubClient;
  parsed: ParsedSource;
  ref: string;
  resolvedPath: string;
  enabledFeatures: Feature[];
  requestedSkills: string[];
  interactive: boolean;
  target: ToolTarget;
  outputDir: string;
  outputRoot: string;
  conflictStrategy: ConflictStrategy;
  logger: Logger;
}): Promise<FetchSummary> {
  const {
    client,
    parsed,
    ref,
    resolvedPath,
    enabledFeatures,
    requestedSkills,
    interactive,
    target,
    outputDir,
    outputRoot,
    conflictStrategy: _conflictStrategy,
    logger,
  } = params;

  // Create a unique temporary directory
  const tempDir = await createTempDirectory();
  logger.debug(`Created temp directory: ${tempDir}`);

  // Create semaphore for concurrency control
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  try {
    // Collect files using rulesync feature paths (rules/, commands/, etc.)
    // External repos use these paths directly without tool-specific prefixes
    const { files: collectedFiles } = await collectFeatureFiles({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      basePath: resolvedPath,
      ref,
      enabledFeatures,
      semaphore,
      logger,
    });

    const filesToFetch = await applySkillSelection({
      files: collectedFiles,
      requestedSkills,
      interactive,
      logger,
    });

    if (filesToFetch.length === 0) {
      logger.warn(`No files found matching enabled features: ${enabledFeatures.join(", ")}`);
      return emptyFetchSummary({ source: `${parsed.owner}/${parsed.repo}`, ref });
    }

    // Validate file sizes first
    for (const { relativePath, size } of filesToFetch) {
      validateFileSize(relativePath, size);
    }

    // Fetch files to temp directory with tool-specific structure in parallel
    // Map rulesync paths to tool-specific paths
    const toolPaths = getToolPathMapping(target);

    await Promise.all(
      filesToFetch.map(async ({ remotePath, relativePath }) => {
        // Map the relative path to tool-specific structure
        const toolRelativePath = mapToToolPath(relativePath, toolPaths);
        checkPathTraversal({
          relativePath: toolRelativePath,
          intendedRootDir: tempDir,
        });
        const localPath = join(tempDir, toolRelativePath);

        // Fetch file content with concurrency control, then write locally
        const content = await withSemaphore(semaphore, () =>
          client.getFileContent(parsed.owner, parsed.repo, remotePath, ref),
        );
        await writeFileContent(localPath, content);
        logger.debug(`Fetched to temp: ${toolRelativePath}`);
      }),
    );

    // Convert fetched files to rulesync format
    const outputBasePath = join(outputRoot, outputDir);
    const { converted, convertedPaths } = await convertFetchedFilesToRulesync({
      tempDir,
      outputDir: outputBasePath,
      target,
      features: enabledFeatures,
      logger,
    });

    // Build results based on conversion with actual file paths
    const results: FetchFileResult[] = convertedPaths.map((relativePath) => ({
      relativePath,
      status: "created" as const,
    }));

    logger.debug(`Converted ${converted} files from ${target} format to rulesync format`);

    return {
      source: `${parsed.owner}/${parsed.repo}`,
      ref,
      files: results,
      created: results.filter((r) => r.status === "created").length,
      overwritten: results.filter((r) => r.status === "overwritten").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      // Skills are the only directory-based feature, and `convertFetchedFilesToRulesync`
      // does not convert them at all, so this path never writes a skill directory
      // there would be anything to prune.
      deleted: 0,
    };
  } finally {
    // Clean up temp directory
    await removeTempDirectory(tempDir);
  }
}

/**
 * Get tool-specific path mapping for a target
 * Returns a mapping from rulesync feature paths to tool-specific paths
 */
function getToolPathMapping(target: ToolTarget): {
  rules?: { root?: string; nonRoot?: string };
  commands?: string;
  subagents?: string;
  skills?: string;
  checks?: string;
} {
  // Get tool-specific paths from each processor class
  const mapping: {
    rules?: { root?: string; nonRoot?: string };
    commands?: string;
    subagents?: string;
    skills?: string;
    checks?: string;
  } = {};

  // Rules paths
  const supportedRulesTargets = RulesProcessor.getToolTargets({ global: false });
  if (supportedRulesTargets.includes(target)) {
    const factory = RulesProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.rules = {
        root: paths.root?.relativeFilePath,
        nonRoot: paths.nonRoot?.relativeDirPath,
      };
    }
  }

  // Commands paths
  const supportedCommandsTargets = CommandsProcessor.getToolTargets({
    global: false,
    includeSimulated: false,
  });
  if (supportedCommandsTargets.includes(target)) {
    const factory = CommandsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.commands = paths.relativeDirPath;
    }
  }

  // Subagents paths
  const supportedSubagentsTargets = SubagentsProcessor.getToolTargets({
    global: false,
    includeSimulated: false,
  });
  if (supportedSubagentsTargets.includes(target)) {
    const factory = SubagentsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.subagents = paths.relativeDirPath;
    }
  }

  // Skills paths
  const supportedSkillsTargets = SkillsProcessor.getToolTargets({ global: false });
  if (supportedSkillsTargets.includes(target)) {
    const factory = SkillsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.skills = paths.relativeDirPath;
    }
  }

  // Checks paths
  const supportedChecksTargets = ChecksProcessor.getToolTargets({ global: false });
  if (supportedChecksTargets.includes(target)) {
    const factory = ChecksProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.checks = paths.relativeDirPath;
    }
  }

  return mapping;
}

/**
 * Map a rulesync-style relative path to tool-specific path
 */
function mapToToolPath(
  relativePath: string,
  toolPaths: ReturnType<typeof getToolPathMapping>,
): string {
  // Check if this is a rules file
  if (relativePath.startsWith("rules/")) {
    const restPath = relativePath.substring("rules/".length);
    if (toolPaths.rules?.nonRoot) {
      return join(toolPaths.rules.nonRoot, restPath);
    }
  }

  // Check if this is a root rule file (e.g., CLAUDE.md, AGENTS.md)
  if (toolPaths.rules?.root && relativePath === toolPaths.rules.root) {
    return relativePath;
  }

  // Check if this is a commands file
  if (relativePath.startsWith("commands/")) {
    const restPath = relativePath.substring("commands/".length);
    if (toolPaths.commands) {
      return join(toolPaths.commands, restPath);
    }
  }

  // Check if this is a subagents file
  if (relativePath.startsWith("subagents/")) {
    const restPath = relativePath.substring("subagents/".length);
    if (toolPaths.subagents) {
      return join(toolPaths.subagents, restPath);
    }
  }

  // Check if this is a skills file
  if (relativePath.startsWith("skills/")) {
    const restPath = relativePath.substring("skills/".length);
    if (toolPaths.skills) {
      return join(toolPaths.skills, restPath);
    }
  }

  // Check if this is a checks file
  if (relativePath.startsWith("checks/")) {
    const restPath = relativePath.substring("checks/".length);
    if (toolPaths.checks) {
      return join(toolPaths.checks, restPath);
    }
  }

  // Default: return as-is
  return relativePath;
}

function fetchStatusIcon(status: FetchFileResult["status"]): string {
  switch (status) {
    case "skipped":
      return "-";
    // Deliberately not the same mark as a write: a deletion is the one part of a
    // fetch that destroys local work, so it must not read as another file added.
    case "deleted":
      return "\u2717";
    default:
      return "\u2713";
  }
}

function fetchStatusText(status: FetchFileResult["status"]): string {
  switch (status) {
    case "created":
      return "(created)";
    case "overwritten":
      return "(overwritten)";
    case "skipped":
      return "(skipped - already exists)";
    case "deleted":
      return "(deleted - no longer in the remote skill)";
  }
}

/**
 * Format fetch summary for display
 */
export function formatFetchSummary(summary: FetchSummary): string {
  const lines: string[] = [];

  lines.push(`Fetched from ${summary.source}@${summary.ref}:`);

  for (const file of summary.files) {
    const icon = fetchStatusIcon(file.status);
    const statusText = fetchStatusText(file.status);
    // A deleted path is a local name read back off the disk, so unlike a
    // fetched one it never went through the checks on a remote path. An escape
    // sequence in it could rewrite or erase the lines around it, and the lines
    // around it are the record of what this command deleted.
    lines.push(`  ${icon} ${stripControlCharacters(file.relativePath)} ${statusText}`);
  }

  const parts: string[] = [];
  if (summary.created > 0) parts.push(`${summary.created} created`);
  if (summary.overwritten > 0) parts.push(`${summary.overwritten} overwritten`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`);

  lines.push("");
  const summaryText = parts.length > 0 ? parts.join(", ") : "no files";
  lines.push(`Summary: ${summaryText}`);

  return lines.join("\n");
}
