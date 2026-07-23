import { cp, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type FormattingOptions,
  type ParseError,
  printParseErrorCode,
} from "jsonc-parser";

import { ConfigResolver } from "../../config/config-resolver.js";
import { ConfigFileSchema, type SourceEntry, SourceEntrySchema } from "../../config/config.js";
import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { normalizeNpmSourceKey } from "../../lib/npm-sources-lock.js";
import { normalizeSourceKey } from "../../lib/sources-lock.js";
import { getInstalledSourceSkillNames, resolveAndFetchSources } from "../../lib/sources.js";
import {
  directoryExists,
  fileExists,
  readFileContent,
  readFileContentOrNull,
  resolvePath,
  writeFileContent,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";

export type AddCommandOptions = {
  source: string;
  skills?: string[];
  transport?: SourceEntry["transport"];
  ref?: string;
  path?: string;
  registry?: string;
  tokenEnv?: string;
  token?: string;
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
};

const SOURCE_ENTRY_KEYS = [
  "source",
  "skills",
  "transport",
  "ref",
  "path",
  "registry",
  "tokenEnv",
  "agent",
  "scope",
] as const satisfies ReadonlyArray<keyof SourceEntry>;

type InstallSnapshot = {
  backupRoot: string;
  curatedExisted: boolean;
  sourcesLockContent: string | null;
  npmSourcesLockContent: string | null;
};

function pathEscapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function assertWritablePathInsideProject({
  projectRoot,
  targetPath,
}: {
  projectRoot: string;
  targetPath: string;
}): Promise<void> {
  let existingPath = targetPath;
  while (true) {
    try {
      const stats = await lstat(existingPath);
      if (existingPath === targetPath && stats.isSymbolicLink()) {
        throw new Error(`Refusing to write through a symbolic link: ${targetPath}.`);
      }
      const relativeRealPath = relative(await realpath(projectRoot), await realpath(existingPath));
      if (pathEscapesRoot(relativeRealPath)) {
        throw new Error(`Writable path must resolve inside the project root: ${targetPath}.`);
      }
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parentPath = dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      existingPath = parentPath;
    }
  }
}

async function assertTreeContainsNoSymlinks(dirPath: string): Promise<void> {
  for (const entry of await readdir(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to write into a tree containing a symbolic link: ${entryPath}.`);
    }
    if (entry.isDirectory()) {
      await assertTreeContainsNoSymlinks(entryPath);
    }
  }
}

async function assertDirectoryIfExists(dirPath: string): Promise<void> {
  try {
    if (!(await lstat(dirPath)).isDirectory()) {
      throw new Error(`Expected a directory at writable path: ${dirPath}.`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

function assertSourceHasNoEmbeddedCredentials(source: string): void {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
    return;
  }
  const url = new URL(source);
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      "Source URLs must not contain credentials. Use an environment variable, credential helper, or SSH authentication instead.",
    );
  }
}

async function createInstallSnapshot({
  projectRoot,
  manifestContent,
}: {
  projectRoot: string;
  manifestContent: string;
}): Promise<InstallSnapshot> {
  const backupRoot = await mkdtemp(join(projectRoot, ".rulesync-add-backup-"));
  const curatedPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedExisted = await directoryExists(curatedPath);
  if (curatedExisted) {
    await cp(curatedPath, join(backupRoot, "curated"), { recursive: true });
  }
  const sourcesLockContent = await readFileContentOrNull(
    join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
  );
  const npmSourcesLockContent = await readFileContentOrNull(
    join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
  );
  await writeFileContent(join(backupRoot, "manifest.jsonc"), manifestContent);
  if (sourcesLockContent !== null) {
    await writeFileContent(
      join(backupRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
      sourcesLockContent,
    );
  }
  if (npmSourcesLockContent !== null) {
    await writeFileContent(
      join(backupRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
      npmSourcesLockContent,
    );
  }
  return {
    backupRoot,
    curatedExisted,
    sourcesLockContent,
    npmSourcesLockContent,
  };
}

async function restoreFile({ path, content }: { path: string; content: string | null }) {
  if (content === null) {
    await rm(path, { force: true });
    return;
  }
  await writeFileContent(path, content);
}

async function restoreInstallSnapshot({
  projectRoot,
  snapshot,
}: {
  projectRoot: string;
  snapshot: InstallSnapshot;
}): Promise<void> {
  const curatedPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  await rm(curatedPath, { recursive: true, force: true });
  if (snapshot.curatedExisted) {
    await cp(join(snapshot.backupRoot, "curated"), curatedPath, { recursive: true });
  }
  await restoreFile({
    path: join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
    content: snapshot.sourcesLockContent,
  });
  await restoreFile({
    path: join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
    content: snapshot.npmSourcesLockContent,
  });
}

async function rollbackAdd({
  configPath,
  originalContent,
  projectRoot,
  snapshot,
}: {
  configPath: string;
  originalContent: string;
  projectRoot: string;
  snapshot: InstallSnapshot;
}): Promise<void> {
  await Promise.all([
    writeFileContent(configPath, originalContent),
    restoreInstallSnapshot({ projectRoot, snapshot }),
  ]);
}

function sourceIdentity(entry: SourceEntry): string {
  const transport = entry.transport ?? "github";
  const normalizedSource =
    transport === "npm" ? normalizeNpmSourceKey(entry.source) : normalizeSourceKey(entry.source);
  const lockfileKind = transport === "npm" ? "npm" : "git";
  return `${lockfileKind}:${normalizedSource}`;
}

function sourceEntriesEqual(left: SourceEntry, right: SourceEntry): boolean {
  return SOURCE_ENTRY_KEYS.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      return (
        leftValue.length === rightValue.length &&
        leftValue.every((value, index) => value === rightValue[index])
      );
    }
    return leftValue === rightValue;
  });
}

function detectFormattingOptions(content: string): FormattingOptions {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const indentedLine = content.match(/^(\s+)["}]/m)?.[1] ?? "  ";
  const insertSpaces = !indentedLine.includes("\t");
  return {
    eol,
    insertSpaces,
    tabSize: insertSpaces ? indentedLine.length : 1,
  };
}

function buildSourceEntry(options: AddCommandOptions): SourceEntry {
  assertSourceHasNoEmbeddedCredentials(options.source);
  return SourceEntrySchema.parse({
    source: options.source,
    skills: options.skills,
    transport: options.transport,
    ref: options.ref,
    path: options.path,
    registry: options.registry,
    tokenEnv: options.tokenEnv,
  });
}

function parseConfigContent(content: string, configPath: string) {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  const firstError = errors[0];
  if (firstError) {
    throw new Error(
      `Failed to parse ${configPath}: ${printParseErrorCode(firstError.error)} at offset ${firstError.offset}.`,
    );
  }
  return ConfigFileSchema.parse(parsed);
}

export async function addCommand(logger: Logger, options: AddCommandOptions): Promise<void> {
  const projectRoot = process.cwd();
  const relativeConfigPath = options.configPath ?? RULESYNC_CONFIG_RELATIVE_FILE_PATH;
  const configPath = resolvePath(relativeConfigPath, projectRoot);

  if (!(await fileExists(configPath))) {
    throw new Error(
      `Configuration file not found: ${relativeConfigPath}. Run 'rulesync init' first or pass --config.`,
    );
  }

  const realProjectRoot = await realpath(projectRoot);
  const realConfigPath = await realpath(configPath);
  const relativeRealConfigPath = relative(realProjectRoot, realConfigPath);
  if (pathEscapesRoot(relativeRealConfigPath)) {
    throw new Error(
      `Configuration file must resolve inside the project root: ${relativeConfigPath}.`,
    );
  }

  const sourceEntry = buildSourceEntry(options);
  const curatedPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  await Promise.all([
    assertWritablePathInsideProject({ projectRoot, targetPath: curatedPath }),
    assertWritablePathInsideProject({
      projectRoot,
      targetPath: join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
    }),
    assertWritablePathInsideProject({
      projectRoot,
      targetPath: join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
    }),
  ]);
  await assertDirectoryIfExists(curatedPath);
  if (await directoryExists(curatedPath)) {
    await assertTreeContainsNoSymlinks(curatedPath);
  }
  const originalContent = await readFileContent(configPath);
  const parsedConfig = parseConfigContent(originalContent, relativeConfigPath);
  const existingSources = parsedConfig.sources ?? [];
  const identity = sourceIdentity(sourceEntry);

  if (existingSources.some((entry) => sourceIdentity(entry) === identity)) {
    throw new Error(
      `Source "${sourceEntry.source}" is already declared in ${relativeConfigPath}. Edit the existing entry to change its options.`,
    );
  }

  const configBeforeEdit = await ConfigResolver.resolve(
    {
      configPath,
      verbose: options.verbose,
      silent: options.silent,
    },
    { logger },
  );
  if (configBeforeEdit.getSources().some((entry) => sourceIdentity(entry) === identity)) {
    throw new Error(
      `Source "${sourceEntry.source}" is already declared in the effective configuration. Edit the existing entry to change its options.`,
    );
  }
  const reservedSkillNames = await getInstalledSourceSkillNames({
    sources: configBeforeEdit.getSources(),
    projectRoot,
    logger,
  });

  const editPath =
    parsedConfig.sources === undefined ? ["sources"] : ["sources", existingSources.length];
  const editValue = parsedConfig.sources === undefined ? [sourceEntry] : sourceEntry;
  const formattingOptions = detectFormattingOptions(originalContent);
  const edits = modify(originalContent, editPath, editValue, { formattingOptions });
  let updatedContent = applyEdits(originalContent, edits);
  if (!updatedContent.endsWith("\n")) {
    updatedContent += formattingOptions.eol;
  }

  // Validate the complete edited document before replacing the user's file.
  parseConfigContent(updatedContent, relativeConfigPath);
  const snapshot = await createInstallSnapshot({ projectRoot, manifestContent: originalContent });
  let cleanupSnapshot = true;
  try {
    await writeFileContent(configPath, updatedContent);
    const config = await ConfigResolver.resolve(
      {
        configPath,
        verbose: options.verbose,
        silent: options.silent,
      },
      { logger },
    );
    const sources = config.getSources();
    if (!sources.some((entry) => sourceEntriesEqual(entry, sourceEntry))) {
      throw new Error(
        `${join(dirname(configPath), RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH)} overrides sources from ${relativeConfigPath}. Add the source to the overriding config or remove its sources key.`,
      );
    }

    const result = await resolveAndFetchSources({
      sources: [sourceEntry],
      projectRoot,
      options: {
        token: options.token,
        updateSources: true,
        preserveUnlistedLockEntries: true,
        requireResolvedSkills: true,
        reservedSkillNames,
      },
      logger,
    });

    if (logger.jsonMode) {
      logger.captureData("source", sourceEntry.source);
      logger.captureData("configPath", relativeConfigPath);
      logger.captureData("sourcesProcessed", result.sourcesProcessed);
      logger.captureData("skillsFetched", result.fetchedSkillCount);
      logger.captureData("failedSourceCount", result.failedSourceCount);
    }

    if (result.failedSourceCount > 0) {
      throw new Error(
        `Failed to install ${result.failedSourceCount} of ${result.sourcesProcessed} source(s); restored ${relativeConfigPath}. See the log above for details.`,
      );
    }

    logger.success(
      `Added "${sourceEntry.source}" to ${relativeConfigPath} and installed ${result.fetchedSkillCount} skill(s).`,
    );
  } catch (error) {
    try {
      await rollbackAdd({ configPath, originalContent, projectRoot, snapshot });
    } catch (rollbackError) {
      cleanupSnapshot = false;
      // oxlint-disable-next-line preserve-caught-error -- AggregateError retains both the operation and rollback failures.
      throw new AggregateError(
        [error, rollbackError],
        `Failed to roll back the add operation. Recovery snapshot retained at ${snapshot.backupRoot}.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (cleanupSnapshot) {
      await rm(snapshot.backupRoot, { recursive: true, force: true });
    }
  }
}
