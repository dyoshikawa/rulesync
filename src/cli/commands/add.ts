import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";

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
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { createFeatureScaffold, parseScaffoldFeatureKeyword } from "../../lib/feature-scaffold.js";
import { normalizeNpmSourceKey } from "../../lib/npm-sources-lock.js";
import { normalizeSourceKey } from "../../lib/sources-lock.js";
import {
  getInstalledSourceRuleNames,
  getInstalledSourceSkillNames,
  resolveAndFetchSources,
} from "../../lib/sources.js";
import {
  assertDirectoryIfExists,
  assertTreeContainsNoSymlinks,
  assertWritablePathInsideRoot,
  directoryExists,
  ensureDir,
  fileExists,
  pathEscapesRoot,
  readFileContent,
  readFileContentOrNull,
  resolvePath,
  writeFileContent,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";

export type AddCommandOptions = {
  source: string;
  skills?: string[];
  rules?: string[];
  transport?: SourceEntry["transport"];
  ref?: string;
  path?: string;
  rulesPath?: string;
  registry?: string;
  tokenEnv?: string;
  token?: string;
  configPath?: string;
  name?: string;
  force?: boolean;
  verbose?: boolean;
  silent?: boolean;
  confirmOverwrite?: (relativeFilePath: string) => Promise<boolean>;
};

const SOURCE_ENTRY_KEYS = [
  "source",
  "skills",
  "rules",
  "transport",
  "ref",
  "path",
  "rulesPath",
  "registry",
  "tokenEnv",
  "agent",
  "scope",
] as const satisfies ReadonlyArray<keyof SourceEntry>;

type InstallSnapshot = {
  backupRoot: string;
  curatedSkillsExisted: boolean;
  curatedRulesExisted: boolean;
  sourcesLockContent: string | null;
  npmSourcesLockContent: string | null;
};

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
  const curatedSkillsPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesPath = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  const curatedSkillsExisted = await directoryExists(curatedSkillsPath);
  const curatedRulesExisted = await directoryExists(curatedRulesPath);
  if (curatedSkillsExisted) {
    await cp(curatedSkillsPath, join(backupRoot, "curated-skills"), { recursive: true });
  }
  if (curatedRulesExisted) {
    await cp(curatedRulesPath, join(backupRoot, "curated-rules"), { recursive: true });
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
    curatedSkillsExisted,
    curatedRulesExisted,
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
  const curatedSkillsPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesPath = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  await Promise.all([
    rm(curatedSkillsPath, { recursive: true, force: true }),
    rm(curatedRulesPath, { recursive: true, force: true }),
  ]);
  if (snapshot.curatedSkillsExisted) {
    await cp(join(snapshot.backupRoot, "curated-skills"), curatedSkillsPath, { recursive: true });
  }
  if (snapshot.curatedRulesExisted) {
    await cp(join(snapshot.backupRoot, "curated-rules"), curatedRulesPath, { recursive: true });
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
    rules: options.rules,
    transport: options.transport,
    ref: options.ref,
    path: options.path,
    rulesPath: options.rulesPath,
    registry: options.registry,
    tokenEnv: options.tokenEnv,
  });
}

function hasSourceOnlyOptions(options: AddCommandOptions): boolean {
  return [
    options.skills,
    options.rules,
    options.transport,
    options.ref,
    options.path,
    options.rulesPath,
    options.registry,
    options.tokenEnv,
    options.token,
    options.configPath,
  ].some((value) => value !== undefined);
}

async function promptForOverwrite(relativeFilePath: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Refusing to overwrite ${relativeFilePath} in non-interactive mode. Re-run with --force to replace it.`,
    );
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Overwrite ${relativeFilePath}? [y/N] `);
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function addFeatureScaffold({
  logger,
  options,
}: {
  logger: Logger;
  options: AddCommandOptions;
}): Promise<void> {
  const feature = parseScaffoldFeatureKeyword(options.source);
  if (!feature) {
    throw new Error("--name and --force are only valid when adding a Rulesync feature file.");
  }

  const scaffold = createFeatureScaffold({ feature, name: options.name });
  const projectRoot = process.cwd();
  let relativeFilePath = scaffold.relativeFilePath;
  for (const candidateRelativeFilePath of scaffold.candidateRelativeFilePaths) {
    if (await fileExists(join(projectRoot, candidateRelativeFilePath))) {
      relativeFilePath = candidateRelativeFilePath;
      break;
    }
  }
  const targetPath = join(projectRoot, relativeFilePath);
  await assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath });

  if ((await fileExists(targetPath)) && !options.force) {
    if (logger.jsonMode || logger.silent) {
      throw new Error(
        `Refusing to prompt before overwriting ${relativeFilePath} in JSON or silent mode. Re-run with --force to replace it.`,
      );
    }
    const confirmed = await (options.confirmOverwrite ?? promptForOverwrite)(relativeFilePath);
    if (!confirmed) {
      logger.info(`Kept ${relativeFilePath} unchanged.`);
      if (logger.jsonMode) {
        logger.captureData("created", []);
        logger.captureData("skipped", [relativeFilePath]);
      }
      return;
    }
  }

  await assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath });
  await ensureDir(dirname(targetPath));
  await assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath });
  await writeFileContent(targetPath, scaffold.content);
  logger.success(`Created ${relativeFilePath}`);
  if (logger.jsonMode) {
    logger.captureData("created", [relativeFilePath]);
    logger.captureData("skipped", []);
  }
}

async function handleFeatureScaffoldRequest({
  logger,
  options,
}: {
  logger: Logger;
  options: AddCommandOptions;
}): Promise<boolean> {
  const feature = parseScaffoldFeatureKeyword(options.source);
  const sourceOnlyOptions = hasSourceOnlyOptions(options);
  const scaffoldOnlyOptions = options.name !== undefined || options.force === true;

  if (feature && scaffoldOnlyOptions && sourceOnlyOptions) {
    throw new Error(
      "Feature scaffold options (--name, --force) cannot be combined with declarative source options.",
    );
  }
  if ((feature && !sourceOnlyOptions) || scaffoldOnlyOptions) {
    await addFeatureScaffold({ logger, options });
    return true;
  }
  return false;
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
  if (await handleFeatureScaffoldRequest({ logger, options })) {
    return;
  }

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
  const curatedSkillsPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesPath = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  await Promise.all([
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: curatedSkillsPath }),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: curatedRulesPath }),
    assertWritablePathInsideRoot({
      rootPath: projectRoot,
      targetPath: join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
    }),
    assertWritablePathInsideRoot({
      rootPath: projectRoot,
      targetPath: join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
    }),
  ]);
  await Promise.all([
    assertDirectoryIfExists(curatedSkillsPath),
    assertDirectoryIfExists(curatedRulesPath),
  ]);
  if (await directoryExists(curatedSkillsPath)) {
    await assertTreeContainsNoSymlinks(curatedSkillsPath);
  }
  if (await directoryExists(curatedRulesPath)) {
    await assertTreeContainsNoSymlinks(curatedRulesPath);
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
  const reservedRuleNames = await getInstalledSourceRuleNames({
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
        requireResolvedSkills: sourceEntry.skills !== undefined || sourceEntry.rules === undefined,
        requireResolvedRules: sourceEntry.rules !== undefined,
        reservedSkillNames,
        reservedRuleNames,
      },
      logger,
    });

    if (logger.jsonMode) {
      logger.captureData("source", sourceEntry.source);
      logger.captureData("configPath", relativeConfigPath);
      logger.captureData("sourcesProcessed", result.sourcesProcessed);
      logger.captureData("skillsFetched", result.fetchedSkillCount);
      logger.captureData("rulesFetched", result.fetchedRuleCount);
      logger.captureData("failedSourceCount", result.failedSourceCount);
    }

    if (result.failedSourceCount > 0) {
      throw new Error(
        `Failed to install ${result.failedSourceCount} of ${result.sourcesProcessed} source(s); restored ${relativeConfigPath}. See the log above for details.`,
      );
    }

    logger.success(
      `Added "${sourceEntry.source}" to ${relativeConfigPath} and installed ${result.fetchedSkillCount} skill(s) and ${result.fetchedRuleCount} rule(s).`,
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
