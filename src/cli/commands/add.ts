import { dirname, join } from "node:path";

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
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { normalizeNpmSourceKey } from "../../lib/npm-sources-lock.js";
import { normalizeSourceKey } from "../../lib/sources-lock.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { fileExists, readFileContent, resolvePath, writeFileContent } from "../../utils/file.js";
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

  const sourceEntry = buildSourceEntry(options);
  const originalContent = await readFileContent(configPath);
  const parsedConfig = parseConfigContent(originalContent, relativeConfigPath);
  const existingSources = parsedConfig.sources ?? [];
  const identity = sourceIdentity(sourceEntry);

  if (existingSources.some((entry) => sourceIdentity(entry) === identity)) {
    throw new Error(
      `Source "${sourceEntry.source}" is already declared in ${relativeConfigPath}. Edit the existing entry to change its options.`,
    );
  }

  const editPath =
    parsedConfig.sources === undefined ? ["sources"] : ["sources", existingSources.length];
  const editValue = parsedConfig.sources === undefined ? [sourceEntry] : sourceEntry;
  const edits = modify(originalContent, editPath, editValue, {
    formattingOptions: detectFormattingOptions(originalContent),
  });
  let updatedContent = applyEdits(originalContent, edits);
  if (!updatedContent.endsWith("\n")) {
    updatedContent += "\n";
  }

  // Validate the complete edited document before replacing the user's file.
  parseConfigContent(updatedContent, relativeConfigPath);
  await writeFileContent(configPath, updatedContent);

  let sources: SourceEntry[];
  try {
    const config = await ConfigResolver.resolve(
      {
        configPath,
        verbose: options.verbose,
        silent: options.silent,
      },
      { logger },
    );
    sources = config.getSources();
    if (!sources.some((entry) => sourceEntriesEqual(entry, sourceEntry))) {
      throw new Error(
        `${join(dirname(configPath), RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH)} overrides sources from ${relativeConfigPath}. Add the source to the overriding config or remove its sources key.`,
      );
    }
  } catch (error) {
    await writeFileContent(configPath, originalContent);
    throw error;
  }

  const result = await resolveAndFetchSources({
    sources,
    projectRoot,
    options: { token: options.token },
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
      `Added the source to ${relativeConfigPath}, but ${result.failedSourceCount} of ${result.sourcesProcessed} source(s) failed to install. See the log above for details.`,
    );
  }

  logger.success(
    `Added "${sourceEntry.source}" to ${relativeConfigPath} and installed ${result.fetchedSkillCount} skill(s).`,
  );
}
