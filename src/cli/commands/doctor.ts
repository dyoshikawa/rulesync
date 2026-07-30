import { dirname, join, relative, resolve } from "node:path";

import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

import {
  CONFLICTING_TARGET_PAIRS,
  ConfigFileSchema,
  GITIGNORE_DESTINATION_KEY,
} from "../../config/config.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_CONFIG_SCHEMA_URL,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { ALL_FEATURES, DEPRECATED_FEATURE_REPLACEMENTS } from "../../types/features.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import { directoryExists, fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";

export type DoctorSeverity = "error" | "warning" | "info";

/**
 * A single diagnostic produced by `rulesync doctor`. Checks stay small and
 * independently testable by returning arrays of these instead of logging or
 * throwing directly.
 */
export type DoctorDiagnostic = {
  severity: DoctorSeverity;
  /** Stable machine-readable code, e.g. "config/unknown-key". */
  code: string;
  /** Path of the offending file, relative to the working directory. */
  file: string;
  message: string;
  /** Concrete fix suggestion, when one is known. */
  hint?: string;
  /** 1-based position, present when the JSONC parser reports an offset. */
  line?: number;
  column?: number;
};

export type DoctorOptions = {
  config?: string;
  strict?: boolean;
  verbose?: boolean;
  silent?: boolean;
};

/** Per-feature object form also accepts a gitignore destination override. */
const PER_FEATURE_EXTRA_KEYS = [GITIGNORE_DESTINATION_KEY] as const;

const KNOWN_CONFIG_KEYS = Object.keys(ConfigFileSchema.shape);

/**
 * Classic dynamic-programming Levenshtein distance; inputs are short config
 * keys and tool names, so the O(a.b) cost is negligible.
 */
export function levenshteinDistance({ a, b }: { a: string; b: string }): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i, ...Array.from({ length: cols - 1 }, () => 0)];
    for (let j = 1; j < cols; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

/**
 * Returns the closest candidate to `input`, or undefined when nothing is close
 * enough to be a plausible typo. The threshold scales with input length so
 * short keys don't produce far-fetched suggestions.
 */
export function suggestNearest({
  input,
  candidates,
}: {
  input: string;
  candidates: readonly string[];
}): string | undefined {
  const maxDistance = Math.max(2, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshteinDistance({ a: input.toLowerCase(), b: candidate.toLowerCase() });
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

function didYouMean({
  input,
  candidates,
}: {
  input: string;
  candidates: readonly string[];
}): string | undefined {
  const suggestion = suggestNearest({ input, candidates });
  return suggestion === undefined ? undefined : `Did you mean '${suggestion}'?`;
}

/** Converts a character offset into a 1-based line/column pair. */
export function offsetToPosition({ content, offset }: { content: string; offset: number }): {
  line: number;
  column: number;
} {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkTargetName({
  name,
  file,
  context,
}: {
  name: string;
  file: string;
  context: string;
}): DoctorDiagnostic | undefined {
  if ((ALL_TOOL_TARGETS as readonly string[]).includes(name)) return undefined;
  return {
    severity: "error",
    code: "config/unknown-target",
    file,
    message: `Unknown tool target '${name}' in ${context}.`,
    hint:
      didYouMean({ input: name, candidates: ALL_TOOL_TARGETS }) ??
      `Valid targets: ${ALL_TOOL_TARGETS.join(", ")}.`,
  };
}

function checkFeatureName({
  name,
  file,
  context,
}: {
  name: string;
  file: string;
  context: string;
}): DoctorDiagnostic | undefined {
  const replacement = DEPRECATED_FEATURE_REPLACEMENTS[name];
  if (replacement !== undefined) {
    return {
      severity: "warning",
      code: "config/deprecated-feature",
      file,
      message: `Feature '${name}' in ${context} is deprecated.`,
      hint: `Use the '${replacement}' feature instead.`,
    };
  }
  if ((ALL_FEATURES as readonly string[]).includes(name)) return undefined;
  return {
    severity: "error",
    code: "config/unknown-feature",
    file,
    message: `Unknown feature '${name}' in ${context}.`,
    hint:
      didYouMean({ input: name, candidates: ALL_FEATURES }) ??
      `Valid features: ${ALL_FEATURES.join(", ")}.`,
  };
}

function checkTargetsValue({
  targets,
  file,
}: {
  targets: unknown;
  file: string;
}): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  if (Array.isArray(targets)) {
    for (const entry of targets) {
      if (typeof entry !== "string") {
        diagnostics.push({
          severity: "error",
          code: "config/invalid-value",
          file,
          message: `'targets' entries must be strings, found ${JSON.stringify(entry)}.`,
        });
        continue;
      }
      if (entry === "*") continue;
      const diagnostic = checkTargetName({ name: entry, file, context: "'targets'" });
      if (diagnostic) diagnostics.push(diagnostic);
    }
    return diagnostics;
  }
  if (isPlainObject(targets)) {
    for (const [key, value] of Object.entries(targets)) {
      if (key === "*") {
        diagnostics.push({
          severity: "error",
          code: "config/invalid-value",
          file,
          message:
            "Wildcard '*' is not supported as a key in the object form of 'targets'; " +
            "per-target options cannot be attached to a wildcard.",
          hint: 'Use the array form `"targets": ["*"]` instead.',
        });
        continue;
      }
      const diagnostic = checkTargetName({
        name: key,
        file,
        context: "the 'targets' object",
      });
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      diagnostics.push(...checkPerTargetFeaturesValue({ target: key, value, file }));
    }
    return diagnostics;
  }
  if (targets !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "config/invalid-value",
      file,
      message: `'targets' must be an array of tool names or a per-target object, found ${JSON.stringify(targets)}.`,
    });
  }
  return diagnostics;
}

function checkPerTargetFeaturesValue({
  target,
  value,
  file,
}: {
  target: string;
  value: unknown;
  file: string;
}): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") {
        diagnostics.push({
          severity: "error",
          code: "config/invalid-value",
          file,
          message: `Features for target '${target}' must be strings, found ${JSON.stringify(entry)}.`,
        });
        continue;
      }
      if (entry === "*") continue;
      const diagnostic = checkFeatureName({
        name: entry,
        file,
        context: `'targets.${target}'`,
      });
      if (diagnostic) diagnostics.push(diagnostic);
    }
    return diagnostics;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key === "*" || (PER_FEATURE_EXTRA_KEYS as readonly string[]).includes(key)) continue;
      const diagnostic = checkFeatureName({
        name: key,
        file,
        context: `'targets.${target}'`,
      });
      if (diagnostic) diagnostics.push(diagnostic);
    }
    return diagnostics;
  }
  diagnostics.push({
    severity: "error",
    code: "config/invalid-value",
    file,
    message: `Value for target '${target}' must be a feature array or a per-feature object, found ${JSON.stringify(value)}.`,
  });
  return diagnostics;
}

function checkFeaturesValue({
  features,
  file,
}: {
  features: unknown;
  file: string;
}): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  if (features === undefined) return diagnostics;
  if (!Array.isArray(features)) {
    diagnostics.push({
      severity: "error",
      code: "config/invalid-value",
      file,
      message: `'features' must be an array of feature names, found ${JSON.stringify(features)}.`,
      hint: "To configure features per target, use the object form of 'targets' instead.",
    });
    return diagnostics;
  }
  for (const entry of features) {
    if (typeof entry !== "string") {
      diagnostics.push({
        severity: "error",
        code: "config/invalid-value",
        file,
        message: `'features' entries must be strings, found ${JSON.stringify(entry)}.`,
      });
      continue;
    }
    if (entry === "*") continue;
    const diagnostic = checkFeatureName({ name: entry, file, context: "'features'" });
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function checkConflictingTargets({
  targets,
  file,
}: {
  targets: unknown;
  file: string;
}): DoctorDiagnostic[] {
  const has = (target: string): boolean => {
    if (Array.isArray(targets)) return targets.includes(target);
    if (isPlainObject(targets)) return Object.prototype.hasOwnProperty.call(targets, target);
    return false;
  };
  const diagnostics: DoctorDiagnostic[] = [];
  for (const [target1, target2] of CONFLICTING_TARGET_PAIRS) {
    if (has(target1) && has(target2)) {
      diagnostics.push({
        severity: "error",
        code: "config/conflicting-targets",
        file,
        message: `Targets '${target1}' and '${target2}' cannot be used together.`,
        hint: "Remove one of the two from 'targets'.",
      });
    }
  }
  return diagnostics;
}

function checkSchemaProperty({
  config,
  file,
}: {
  config: Record<string, unknown>;
  file: string;
}): DoctorDiagnostic[] {
  const schema = config.$schema;
  if (schema === undefined) {
    return [
      {
        severity: "info",
        code: "config/missing-schema",
        file,
        message: "No '$schema' property; editors cannot offer completion and validation.",
        hint: `Add "$schema": "${RULESYNC_CONFIG_SCHEMA_URL}".`,
      },
    ];
  }
  if (typeof schema === "string" && schema !== RULESYNC_CONFIG_SCHEMA_URL) {
    return [
      {
        severity: "warning",
        code: "config/outdated-schema",
        file,
        message: `'$schema' does not point at the current rulesync config schema.`,
        hint: `Update it to "${RULESYNC_CONFIG_SCHEMA_URL}".`,
      },
    ];
  }
  return [];
}

function checkUnknownTopLevelKeys({
  config,
  file,
}: {
  config: Record<string, unknown>;
  file: string;
}): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  for (const key of Object.keys(config)) {
    if (KNOWN_CONFIG_KEYS.includes(key)) continue;
    diagnostics.push({
      severity: "error",
      code: "config/unknown-key",
      file,
      message: `Unknown key '${key}'. It is silently ignored by 'rulesync generate'.`,
      hint:
        didYouMean({ input: key, candidates: KNOWN_CONFIG_KEYS }) ??
        `Known keys: ${KNOWN_CONFIG_KEYS.join(", ")}.`,
    });
  }
  return diagnostics;
}

function checkTargetsFeaturesExclusivity({
  config,
  file,
}: {
  config: Record<string, unknown>;
  file: string;
}): DoctorDiagnostic[] {
  if (!isPlainObject(config.targets) || config.features === undefined) return [];
  return [
    {
      severity: "error",
      code: "config/targets-features-conflict",
      file,
      message: "When 'targets' is in object form, 'features' must be omitted.",
      hint: "Declare per-target features inside the 'targets' object instead.",
    },
  ];
}

function checkTokenEnvVars({
  config,
  file,
  env,
}: {
  config: Record<string, unknown>;
  file: string;
  env: Record<string, string | undefined>;
}): DoctorDiagnostic[] {
  if (!Array.isArray(config.sources)) return [];
  const diagnostics: DoctorDiagnostic[] = [];
  for (const source of config.sources) {
    if (!isPlainObject(source)) continue;
    const tokenEnv = source.tokenEnv;
    if (typeof tokenEnv !== "string" || tokenEnv.length === 0) continue;
    if (env[tokenEnv] === undefined || env[tokenEnv] === "") {
      diagnostics.push({
        severity: "warning",
        code: "config/token-env-not-set",
        file,
        message: `Source '${String(source.source ?? "<unnamed>")}' references environment variable '${tokenEnv}', which is not set.`,
        hint: `Export ${tokenEnv} before running commands that fetch from this source.`,
      });
    }
  }
  return diagnostics;
}

/**
 * Structural validation via the same Zod schema `ConfigResolver` uses.
 * `targets` / `features` issues are skipped because the dedicated checks above
 * already reported them with better messages and suggestions.
 */
function checkAgainstConfigFileSchema({
  config,
  file,
}: {
  config: Record<string, unknown>;
  file: string;
}): DoctorDiagnostic[] {
  const result = ConfigFileSchema.safeParse(config);
  if (result.success) return [];
  const diagnostics: DoctorDiagnostic[] = [];
  for (const issue of result.error.issues) {
    const topLevelKey = issue.path[0];
    if (topLevelKey === "targets" || topLevelKey === "features") continue;
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    diagnostics.push({
      severity: "error",
      code: "config/invalid-value",
      file,
      message: `Invalid value at '${path}': ${issue.message}`,
    });
  }
  return diagnostics;
}

/**
 * Runs every per-file check against one configuration file's raw content.
 * Pure with respect to the filesystem so each check is unit-testable; only the
 * `tokenEnv` check consults the provided environment map.
 */
export function collectConfigFileDiagnostics({
  file,
  content,
  env = process.env,
}: {
  file: string;
  content: string;
  env?: Record<string, string | undefined>;
}): DoctorDiagnostic[] {
  if (content.trim() === "") {
    return [
      {
        severity: "warning",
        code: "config/empty-file",
        file,
        message: "Configuration file is empty; rulesync will run with built-in defaults.",
      },
    ];
  }
  const parseErrors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, parseErrors, {
    allowTrailingComma: true,
  });
  if (parseErrors.length > 0) {
    return parseErrors.map((parseError) => {
      const { line, column } = offsetToPosition({ content, offset: parseError.offset });
      return {
        severity: "error" as const,
        code: "config/parse-error",
        file,
        message: `JSONC parse error: ${printParseErrorCode(parseError.error)}.`,
        line,
        column,
      };
    });
  }
  if (!isPlainObject(parsed)) {
    return [
      {
        severity: "error",
        code: "config/not-an-object",
        file,
        message: `Configuration file must contain a JSON object, found ${JSON.stringify(parsed)}.`,
      },
    ];
  }

  return [
    ...checkUnknownTopLevelKeys({ config: parsed, file }),
    ...checkSchemaProperty({ config: parsed, file }),
    ...checkTargetsValue({ targets: parsed.targets, file }),
    ...checkFeaturesValue({ features: parsed.features, file }),
    ...checkTargetsFeaturesExclusivity({ config: parsed, file }),
    ...checkConflictingTargets({ targets: parsed.targets, file }),
    ...checkTokenEnvVars({ config: parsed, file, env }),
    ...checkAgainstConfigFileSchema({ config: parsed, file }),
  ];
}

/**
 * A base file and a local file can each be valid in isolation yet merge into
 * the invalid `{ targets: object, features: array }` state — the same
 * cross-file rule `ConfigResolver` enforces at generate time.
 */
export function collectMergedConfigDiagnostics({
  baseConfig,
  localConfig,
  baseFile,
  localFile,
}: {
  baseConfig: Record<string, unknown> | undefined;
  localConfig: Record<string, unknown> | undefined;
  baseFile: string;
  localFile: string;
}): DoctorDiagnostic[] {
  if (baseConfig === undefined || localConfig === undefined) return [];
  // The merged object-form-`targets` + `features` state is the same invalid
  // combination `assertTargetsFeaturesExclusive` rejects at generate time,
  // detected here on the post-merge (local ?? base) values.
  const mergedTargets = localConfig.targets ?? baseConfig.targets;
  const mergedFeatures = localConfig.features ?? baseConfig.features;
  if (!isPlainObject(mergedTargets) || mergedFeatures === undefined) return [];
  // Skip when a single file already carries the conflict — the per-file check
  // reported it there.
  const conflictWithinOneFile =
    (isPlainObject(baseConfig.targets) && baseConfig.features !== undefined) ||
    (isPlainObject(localConfig.targets) && localConfig.features !== undefined);
  if (conflictWithinOneFile) return [];
  return [
    {
      severity: "error",
      code: "config/targets-features-conflict",
      file: localFile,
      message:
        `Merging '${baseFile}' with '${localFile}' combines object-form 'targets' ` +
        "with 'features', which is invalid.",
      hint: "Remove the conflicting field from one of the two files.",
    },
  ];
}

function severityRank(severity: DoctorSeverity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

/**
 * Strips control characters (including ANSI escape sequences) so key names and
 * values copied out of an untrusted config file cannot inject terminal escape
 * codes into the diagnostic output.
 */
function stripControlCharacters(text: string): string {
  // oxlint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function formatDiagnostic(diagnostic: DoctorDiagnostic): string {
  const position =
    diagnostic.line !== undefined
      ? `:${diagnostic.line}${diagnostic.column !== undefined ? `:${diagnostic.column}` : ""}`
      : "";
  const label =
    diagnostic.severity === "error" ? "✖" : diagnostic.severity === "warning" ? "⚠" : "ℹ";
  const hint =
    diagnostic.hint === undefined ? "" : `\n    ↳ ${stripControlCharacters(diagnostic.hint)}`;
  return `${label} ${stripControlCharacters(diagnostic.file)}${position} [${diagnostic.code}] ${stripControlCharacters(diagnostic.message)}${hint}`;
}

/**
 * Re-parses an already-read config file's content for the cross-file checks.
 * Returns undefined when the content is unparseable or not an object — the
 * per-file checks have already reported those states.
 */
function parseConfigObjectForMerge(
  content: string | undefined,
): Record<string, unknown> | undefined {
  if (content === undefined) return undefined;
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isPlainObject(parsed)) return undefined;
  return parsed;
}

/**
 * Path sanity: an `inputRoot` that does not exist means every command will
 * fail (or silently read nothing); local config wins, mirroring the merge
 * order in `ConfigResolver`.
 */
async function checkInputRootExists({
  baseConfig,
  localConfig,
  baseFile,
  localFile,
}: {
  baseConfig: Record<string, unknown> | undefined;
  localConfig: Record<string, unknown> | undefined;
  baseFile: string;
  localFile: string;
}): Promise<DoctorDiagnostic[]> {
  const mergedInputRoot = localConfig?.inputRoot ?? baseConfig?.inputRoot;
  if (typeof mergedInputRoot !== "string" || mergedInputRoot.length === 0) return [];
  if (await directoryExists(resolve(mergedInputRoot))) return [];
  return [
    {
      severity: "error",
      code: "config/input-root-not-found",
      file: localConfig?.inputRoot !== undefined ? localFile : baseFile,
      message: `'inputRoot' points at '${mergedInputRoot}', which is not an existing directory.`,
      hint: "Create the directory or fix the 'inputRoot' path.",
    },
  ];
}

function reportDiagnostics({
  logger,
  diagnostics,
}: {
  logger: Logger;
  diagnostics: DoctorDiagnostic[];
}): void {
  // In JSON mode the diagnostics travel via `captureData`; going through
  // `logger.error` here would emit the error document early (JsonLogger
  // prints on the first error call) with a generic code.
  if (logger.jsonMode) return;
  for (const diagnostic of diagnostics) {
    const formatted = formatDiagnostic(diagnostic);
    if (diagnostic.severity === "error") {
      logger.error(formatted);
    } else if (diagnostic.severity === "warning") {
      logger.warn(formatted);
    } else {
      logger.info(formatted);
    }
  }
}

/**
 * `rulesync doctor` — read-only diagnostics for the configuration files.
 * Never writes; exits non-zero when errors (or, with --strict, warnings) are
 * found.
 */
export async function doctorCommand(logger: Logger, options: DoctorOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = options.config ?? RULESYNC_CONFIG_RELATIVE_FILE_PATH;
  const validatedConfigPath = resolvePath(configPath, cwd);
  const localConfigPath = join(
    dirname(validatedConfigPath),
    RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  );

  const toDisplayPath = (absolutePath: string): string => {
    const relativePath = relative(cwd, absolutePath);
    return relativePath === "" || relativePath.startsWith("..") ? absolutePath : relativePath;
  };

  const diagnostics: DoctorDiagnostic[] = [];

  const baseExists = await fileExists(validatedConfigPath);
  if (!baseExists) {
    diagnostics.push({
      severity: "info",
      code: "config/no-config-file",
      file: toDisplayPath(validatedConfigPath),
      message: "No configuration file found; rulesync will run with built-in defaults.",
      hint: "Run 'rulesync init' to scaffold one.",
    });
  }

  // Read each file once; the same content feeds the per-file checks and the
  // cross-file merge checks below.
  const fileContents = new Map<string, string>();
  for (const filePath of [validatedConfigPath, localConfigPath]) {
    if (!(await fileExists(filePath))) continue;
    const content = await readFileContent(filePath);
    fileContents.set(filePath, content);
    diagnostics.push(...collectConfigFileDiagnostics({ file: toDisplayPath(filePath), content }));
  }

  const baseConfig = parseConfigObjectForMerge(fileContents.get(validatedConfigPath));
  const localConfig = parseConfigObjectForMerge(fileContents.get(localConfigPath));
  diagnostics.push(
    ...collectMergedConfigDiagnostics({
      baseConfig,
      localConfig,
      baseFile: toDisplayPath(validatedConfigPath),
      localFile: toDisplayPath(localConfigPath),
    }),
  );

  diagnostics.push(
    ...(await checkInputRootExists({
      baseConfig,
      localConfig,
      baseFile: toDisplayPath(validatedConfigPath),
      localFile: toDisplayPath(localConfigPath),
    })),
  );

  diagnostics.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const infoCount = diagnostics.filter((d) => d.severity === "info").length;

  reportDiagnostics({ logger, diagnostics });

  if (logger.jsonMode) {
    logger.captureData("diagnostics", diagnostics);
    logger.captureData("summary", {
      errors: errorCount,
      warnings: warningCount,
      infos: infoCount,
    });
  }

  const summary = `${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s)`;
  if (errorCount > 0 || (options.strict === true && warningCount > 0)) {
    throw new CLIError(`Doctor found problems: ${summary}.`, ErrorCodes.DOCTOR_FAILED);
  }
  if (warningCount > 0) {
    logger.warn(`Doctor finished with ${summary}.`);
    return;
  }
  logger.success(`✓ No problems found (${summary}).`);
}
