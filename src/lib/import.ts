import { Config } from "../config/config.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { serializeSharedConfig } from "../features/shared/shared-config-gateway.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { FeatureProcessor } from "../types/feature-processor.js";
import type { Feature } from "../types/features.js";
import type { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { fileExists, readFileContent } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import {
  assertPluginRootSafe,
  formatPackagingTargetGlobalMessage,
  isPackagingToolTarget,
} from "../utils/plugin-root.js";
import type { FeatureCounts } from "../utils/result.js";
import {
  resolveRulesyncSourceWritePath,
  type RulesyncSourceSettablePaths,
} from "../utils/rulesync-source-path.js";
import { resolveToolOutputRoot } from "../utils/tool-output-root.js";
import { resetRunWarningState } from "../utils/warned-once.js";

async function applyRulesyncSourcePath<T extends RulesyncFile>({
  files,
  paths,
  sourceClass,
  outputRoot,
}: {
  files: T[];
  paths: RulesyncSourceSettablePaths;
  sourceClass: new (params: RulesyncFileParams) => T;
  outputRoot?: string;
}): Promise<T[]> {
  const first = files[0];
  if (!first) {
    return files;
  }

  const destinationOutputRoot = outputRoot ?? first.getOutputRoot();
  const destination = await resolveRulesyncSourceWritePath({
    outputRoot: destinationOutputRoot,
    paths,
  });
  return files.map(
    (file) =>
      new sourceClass({
        outputRoot: destinationOutputRoot,
        relativeDirPath: destination.relativeDirPath,
        relativeFilePath: destination.relativeFilePath,
        fileContent: file.getFileContent(),
        validate: true,
      }),
  );
}

export type ImportResult = FeatureCounts;

function getToolOutputRoot({ config, tool }: { config: Config; tool: ToolTarget }): string {
  return resolveToolOutputRoot({
    outputRoot: config.getOutputRoots(tool)[0] ?? ".",
    toolTarget: tool,
    global: config.getGlobal(),
  });
}

/**
 * Import configuration files from AI tools.
 */
export async function importFromTool(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<ImportResult> {
  const { config, tool, logger } = params;

  // "Once per run" means once per import, not once per process: the MCP server
  // and `--watch` keep one process alive across many runs, and a warning that
  // still applies has to be said again.
  resetRunWarningState();

  // Import takes exactly one tool, so a packaging target in global mode has
  // nothing left to import; reject it before the plugin root safety check
  // walks the home directory.
  if (config.getGlobal() && isPackagingToolTarget(tool)) {
    throw new Error(formatPackagingTargetGlobalMessage(tool));
  }

  await assertPluginRootSafe({
    toolTarget: tool,
    outputRoot: getToolOutputRoot({ config, tool }),
  });

  const rulesCount = await importRulesCore({ config, tool, logger });
  const ignoreCount = await runFeatureImport({ config, tool, logger }, IGNORE_IMPORT_STRATEGY);
  const mcpCount = await runFeatureImport({ config, tool, logger }, MCP_IMPORT_STRATEGY);
  const commandsCount = await runFeatureImport({ config, tool, logger }, COMMANDS_IMPORT_STRATEGY);
  const subagentsCount = await runFeatureImport(
    { config, tool, logger },
    SUBAGENTS_IMPORT_STRATEGY,
  );
  const skillsCount = await importSkillsCore({ config, tool, logger });
  const hooksCount = await runFeatureImport({ config, tool, logger }, HOOKS_IMPORT_STRATEGY);
  const permissionsCount = await runFeatureImport(
    { config, tool, logger },
    PERMISSIONS_IMPORT_STRATEGY,
  );
  const checksCount = await runFeatureImport({ config, tool, logger }, CHECKS_IMPORT_STRATEGY);

  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount,
    hooksCount,
    permissionsCount,
    checksCount,
  };
}

async function importRulesCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("rules")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = RulesProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const outputRoot = getToolOutputRoot({ config, tool });
  const baseParams = { outputRoot, toolTarget: tool, global, logger };
  const rulesProcessor = new RulesProcessor(baseParams);

  const toolFiles = await rulesProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No rule files found for ${tool}. Skipping import.`);
    return 0;
  }

  // The duplication check predicts where generate writes the existing
  // rulesync rules, so it needs generate's configuration; the import itself
  // keeps the plain processor above. It only warns, so a failure (e.g. a
  // malformed rule in another input root) must not abort the import.
  try {
    const duplicationCheckProcessor = new RulesProcessor({
      ...baseParams,
      inputRoots: config.getInputRoots(),
      deriveSubprojectPathFromGlobs: config.getDeriveSubprojectPathFromGlobs(),
      featureOptions: config.getFeatureOptions(tool, "rules"),
    });
    await duplicationCheckProcessor.warnForFoldImportDuplicationRisk();
  } catch (error) {
    logger.warn(`Skipped the ${tool} import duplication check: ${formatError(error)}`);
  }

  const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await rulesProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} rule files`);
  }

  return writtenCount;
}

async function importSkillsCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("skills")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = SkillsProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const skillsProcessor = new SkillsProcessor({
    outputRoot: getToolOutputRoot({ config, tool }),
    toolTarget: tool,
    global,
    logger,
  });

  const toolDirs = await skillsProcessor.loadToolDirs();
  if (toolDirs.length === 0) {
    logger.warn(`No skill directories found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncDirs = await skillsProcessor.convertToolDirsToRulesyncDirs(toolDirs);
  const rebasedRulesyncDirs = rulesyncDirs.map((dir) => {
    if (!isPackagingToolTarget(tool)) {
      return dir;
    }
    if (!(dir instanceof RulesyncSkill)) {
      return dir;
    }
    return new RulesyncSkill({
      outputRoot: process.cwd(),
      relativeDirPath: dir.getRelativeDirPath(),
      dirName: dir.getDirName(),
      frontmatter: dir.getFrontmatter(),
      body: dir.getBody(),
      otherFiles: dir.getOtherFiles(),
      validate: true,
      global: false,
    });
  });
  const { count: writtenCount } = await skillsProcessor.writeAiDirs(rebasedRulesyncDirs);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} skill directories`);
  }

  return writtenCount;
}

/**
 * Fold each imported permissions document into the canonical file already on
 * disk (see `RulesyncPermissions.mergeImportedJson`), so importing from one
 * tool keeps the categories an earlier import from another tool produced. The
 * existing file is validated first: one that cannot be read is an error rather
 * than something to overwrite. Comments in a JSONC source are kept wherever
 * the edit allows.
 */
async function mergeIntoExistingPermissions({
  files,
  tool,
  logger,
}: {
  files: RulesyncFile[];
  tool: ToolTarget;
  logger: Logger;
}): Promise<RulesyncFile[]> {
  const first = files[0];
  if (!first || !(await fileExists(first.getFilePath()))) {
    return files;
  }

  const withContent = (fileContent: string): RulesyncPermissions =>
    new RulesyncPermissions({
      outputRoot: first.getOutputRoot(),
      relativeDirPath: first.getRelativeDirPath(),
      relativeFilePath: first.getRelativeFilePath(),
      fileContent,
      validate: true,
    });

  const existingContent = await readFileContent(first.getFilePath());
  let existing: Record<string, unknown>;
  try {
    existing = withContent(existingContent).getJson();
  } catch (error) {
    throw new Error(
      `Cannot merge imported permissions into ${first.getRelativePathFromCwd()}: the existing file is invalid (${formatError(error)}). Fix or remove it, then import again.`,
      { cause: error },
    );
  }

  const merged = files.reduce(
    (document, file) =>
      file instanceof RulesyncPermissions
        ? RulesyncPermissions.mergeImportedJson({
            existing: document,
            imported: file.getJson(),
            toolTarget: tool,
          })
        : document,
    existing,
  );
  const fileContent = serializeSharedConfig({
    format: "jsonc",
    document: merged,
    existingContent,
    filePath: first.getRelativePathFromCwd(),
    logger,
  });
  return [withContent(fileContent)];
}

type ImportStrategy = {
  feature: Feature;
  getToolTargets: (global: boolean) => readonly ToolTarget[];
  /**
   * Targets whose files can be read back. A target outside this list but
   * inside `getToolTargets` gets `Import is not supported for <tool>
   * <label>. Skipping.`
   */
  importable?: { getToolTargets: (global: boolean) => readonly ToolTarget[]; label: string };
  createProcessor: (params: {
    config: Config;
    tool: ToolTarget;
    global: boolean;
    logger: Logger;
  }) => FeatureProcessor;
  /** Used in `No <missingLabel> found for <tool>. Skipping import.` */
  missingLabel: string;
  /** Rewrites the converted rulesync files before they are written. */
  postConvert?: (params: {
    files: RulesyncFile[];
    tool: ToolTarget;
    logger: Logger;
  }) => Promise<RulesyncFile[]>;
  /** Logged in verbose mode, before the count, whether or not anything was written. */
  verboseSummary?: (toolFileCount: number) => string;
  /** Used in `Created <count> <createdLabel>`. */
  createdLabel: string;
};

/**
 * Import one file-based feature from `tool`: check the feature is enabled and
 * the tool supports it, load the tool files, convert them to rulesync files
 * and write them.
 */
async function runFeatureImport(
  params: { config: Config; tool: ToolTarget; logger: Logger },
  strategy: ImportStrategy,
): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes(strategy.feature)) {
    return 0;
  }

  const global = config.getGlobal();
  if (!strategy.getToolTargets(global).includes(tool)) {
    return 0;
  }

  if (strategy.importable && !strategy.importable.getToolTargets(global).includes(tool)) {
    logger.warn(`Import is not supported for ${tool} ${strategy.importable.label}. Skipping.`);
    return 0;
  }

  const processor = strategy.createProcessor({ config, tool, global, logger });

  const toolFiles = await processor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No ${strategy.missingLabel} found for ${tool}. Skipping import.`);
    return 0;
  }

  const convertedFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
  const rulesyncFiles = strategy.postConvert
    ? await strategy.postConvert({ files: convertedFiles, tool, logger })
    : convertedFiles;
  const { count: writtenCount } = await processor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && strategy.verboseSummary) {
    logger.success(strategy.verboseSummary(toolFiles.length));
  }

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} ${strategy.createdLabel}`);
  }

  return writtenCount;
}

/**
 * A packaging target imports into the project (`process.cwd()`) rather than
 * into the plugin directory the tool files were read from.
 */
function getPackagingImportOutputRoot(tool: ToolTarget): string | undefined {
  return isPackagingToolTarget(tool) ? process.cwd() : undefined;
}

const IGNORE_IMPORT_STRATEGY: ImportStrategy = {
  feature: "ignore",
  getToolTargets: (global) => IgnoreProcessor.getToolTargets({ global }),
  createProcessor: ({ config, tool, global, logger }) =>
    new IgnoreProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
      featureOptions: config.getFeatureOptions(tool, "ignore"),
    }),
  missingLabel: "ignore files",
  verboseSummary: (toolFileCount) =>
    `Created ignore files from ${toolFileCount} tool ignore configurations`,
  createdLabel: "ignore files",
};

const MCP_IMPORT_STRATEGY: ImportStrategy = {
  feature: "mcp",
  getToolTargets: (global) => McpProcessor.getToolTargets({ global }),
  createProcessor: ({ config, tool, global, logger }) =>
    new McpProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "MCP files",
  postConvert: ({ files, tool }) =>
    applyRulesyncSourcePath({
      files,
      paths: RulesyncMcp.getSettablePaths(),
      sourceClass: RulesyncMcp,
      outputRoot: getPackagingImportOutputRoot(tool),
    }),
  createdLabel: "MCP files",
};

const COMMANDS_IMPORT_STRATEGY: ImportStrategy = {
  feature: "commands",
  getToolTargets: (global) => CommandsProcessor.getToolTargets({ global, includeSimulated: false }),
  createProcessor: ({ config, tool, global, logger }) =>
    new CommandsProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "command files",
  createdLabel: "command files",
};

const SUBAGENTS_IMPORT_STRATEGY: ImportStrategy = {
  feature: "subagents",
  // Simulated subagents have no tool files to read back.
  getToolTargets: (global) =>
    SubagentsProcessor.getToolTargets({ global, includeSimulated: false }),
  createProcessor: ({ config, tool, global, logger }) =>
    new SubagentsProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "subagent files",
  createdLabel: "subagent files",
};

const HOOKS_IMPORT_STRATEGY: ImportStrategy = {
  feature: "hooks",
  getToolTargets: (global) => HooksProcessor.getToolTargets({ global }),
  importable: {
    getToolTargets: (global) => HooksProcessor.getToolTargets({ global, importOnly: true }),
    label: "hooks",
  },
  createProcessor: ({ config, tool, global, logger }) =>
    new HooksProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "hooks files",
  postConvert: ({ files, tool }) =>
    applyRulesyncSourcePath({
      files,
      paths: RulesyncHooks.getSettablePaths(),
      sourceClass: RulesyncHooks,
      outputRoot: getPackagingImportOutputRoot(tool),
    }),
  createdLabel: "hooks file(s)",
};

const PERMISSIONS_IMPORT_STRATEGY: ImportStrategy = {
  feature: "permissions",
  getToolTargets: (global) => PermissionsProcessor.getToolTargets({ global }),
  importable: {
    getToolTargets: (global) => PermissionsProcessor.getToolTargets({ global, importOnly: true }),
    label: "permissions",
  },
  createProcessor: ({ config, tool, global, logger }) =>
    new PermissionsProcessor({
      outputRoot: getToolOutputRoot({ config, tool }),
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "permissions files",
  postConvert: async ({ files, tool, logger }) =>
    mergeIntoExistingPermissions({
      files: await applyRulesyncSourcePath({
        files,
        paths: RulesyncPermissions.getSettablePaths(),
        sourceClass: RulesyncPermissions,
      }),
      tool,
      logger,
    }),
  createdLabel: "permissions file(s)",
};

const CHECKS_IMPORT_STRATEGY: ImportStrategy = {
  feature: "checks",
  getToolTargets: (global) => ChecksProcessor.getToolTargets({ global }),
  createProcessor: ({ config, tool, global, logger }) =>
    new ChecksProcessor({
      outputRoot: config.getOutputRoots()[0] ?? ".",
      toolTarget: tool,
      global,
      logger,
    }),
  missingLabel: "check files",
  createdLabel: "check files",
};
