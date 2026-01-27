import { join, relative } from "node:path";

import { PluginMergeStrategy, Plugins } from "../../config/config.js";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { RulesyncRule } from "../rules/rulesync-rule.js";
import { LoadedPlugin } from "./plugin-loader.js";
import {
  mergeFiles,
  MergeableFile,
  MergeResult,
  pluginsToMergeableFiles,
} from "./plugin-merger.js";
import { resolvePlugins, ResolvedPlugins } from "./plugin-resolver.js";

/**
 * Merged content from plugins and local .rulesync/ directory.
 */
export type MergedPluginContent = {
  /** Merge result for rules */
  rules: MergeResult;
  /** Merge result for commands */
  commands: MergeResult;
  /** Merge result for subagents */
  subagents: MergeResult;
  /** Loaded plugins for skills and MCP processing */
  plugins: LoadedPlugin[];
  /** Plugin resolution errors */
  resolutionErrors: ResolvedPlugins["errors"];
};

/**
 * Process plugins and merge with local .rulesync/ content.
 *
 * @param plugins - Plugin configuration from rulesync.jsonc
 * @param baseDir - Base directory containing .rulesync/
 * @param mergeStrategy - Strategy for resolving conflicts
 * @returns Merged content ready for generation
 */
export async function processPlugins(params: {
  plugins: Plugins;
  baseDir?: string;
  mergeStrategy?: PluginMergeStrategy;
}): Promise<MergedPluginContent> {
  const { plugins, baseDir = process.cwd(), mergeStrategy = "local-first" } = params;

  // Resolve and load all enabled plugins
  const resolved = await resolvePlugins({ plugins, baseDir });

  // Get local files from .rulesync/
  const localRulesFiles = await getLocalFiles({
    baseDir,
    featureDir: RULESYNC_RULES_RELATIVE_DIR_PATH,
  });
  const localCommandsFiles = await getLocalFiles({
    baseDir,
    featureDir: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  });
  const localSubagentsFiles = await getLocalFiles({
    baseDir,
    featureDir: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
  });

  // Get plugin files
  const pluginRulesFiles = pluginsToMergeableFiles({
    plugins: resolved.plugins,
    featureType: "rules",
  });
  const pluginCommandsFiles = pluginsToMergeableFiles({
    plugins: resolved.plugins,
    featureType: "commands",
  });
  const pluginSubagentsFiles = pluginsToMergeableFiles({
    plugins: resolved.plugins,
    featureType: "subagents",
  });

  // Merge local and plugin files
  const rulesMergeResult = mergeFiles({
    localFiles: localRulesFiles,
    pluginFiles: pluginRulesFiles,
    strategy: mergeStrategy,
  });
  const commandsMergeResult = mergeFiles({
    localFiles: localCommandsFiles,
    pluginFiles: pluginCommandsFiles,
    strategy: mergeStrategy,
  });
  const subagentsMergeResult = mergeFiles({
    localFiles: localSubagentsFiles,
    pluginFiles: pluginSubagentsFiles,
    strategy: mergeStrategy,
  });

  // Log merge statistics
  logMergeStatistics({
    rules: rulesMergeResult,
    commands: commandsMergeResult,
    subagents: subagentsMergeResult,
  });

  return {
    rules: rulesMergeResult,
    commands: commandsMergeResult,
    subagents: subagentsMergeResult,
    plugins: resolved.plugins,
    resolutionErrors: resolved.errors,
  };
}

/**
 * Get local files from a feature directory as mergeable files.
 *
 * @param baseDir - Base directory containing .rulesync/
 * @param featureDir - Feature directory path (e.g., '.rulesync/rules')
 * @returns Array of local mergeable files
 */
async function getLocalFiles(params: {
  baseDir: string;
  featureDir: string;
}): Promise<MergeableFile[]> {
  const { baseDir, featureDir } = params;
  const absoluteFeatureDir = join(baseDir, featureDir);

  try {
    const files = await findFilesByGlobs(join(absoluteFeatureDir, "**", "*.md"));
    return files.map((absolutePath) => ({
      source: "local" as const,
      relativePath: relative(absoluteFeatureDir, absolutePath),
      absolutePath,
    }));
  } catch {
    return [];
  }
}

/**
 * Log merge statistics for debugging.
 */
function logMergeStatistics(params: {
  rules: MergeResult;
  commands: MergeResult;
  subagents: MergeResult;
}): void {
  const { rules, commands, subagents } = params;

  const totalFiles = rules.files.length + commands.files.length + subagents.files.length;
  const totalConflicts =
    rules.resolvedConflicts.length +
    commands.resolvedConflicts.length +
    subagents.resolvedConflicts.length;
  const totalErrors = rules.errors.length + commands.errors.length + subagents.errors.length;

  if (totalFiles > 0) {
    logger.debug(
      `Plugin merge complete: ${totalFiles} files, ${totalConflicts} conflicts resolved, ${totalErrors} errors`,
    );
  }

  // Log individual errors
  for (const error of [...rules.errors, ...commands.errors, ...subagents.errors]) {
    logger.error(`Plugin merge error: ${error}`);
  }
}

/**
 * Check if there are any enabled plugins in the configuration.
 *
 * @param plugins - Plugin configuration
 * @returns True if any plugins are enabled
 */
export function hasEnabledPlugins(plugins: Plugins): boolean {
  return Object.values(plugins).some((enabled) => enabled);
}

/**
 * Convert merged rule files to RulesyncRule instances.
 *
 * @param mergeResult - Result from mergeFiles for rules
 * @param baseDir - Base directory for the project
 * @returns Array of RulesyncRule instances
 */
export async function mergedFilesToRulesyncRules(params: {
  mergeResult: MergeResult;
  baseDir?: string;
}): Promise<RulesyncRule[]> {
  const { mergeResult, baseDir = process.cwd() } = params;
  const rules: RulesyncRule[] = [];

  for (const file of mergeResult.files) {
    try {
      const rule = await RulesyncRule.fromAbsolutePath({
        absolutePath: file.absolutePath,
        relativeFilePath: file.relativePath,
        baseDir,
        validate: true,
      });
      rules.push(rule);
    } catch (error) {
      const source = file.source === "plugin" ? `plugin '${file.pluginName}'` : "local";
      logger.warn(
        `Failed to load rule from ${source}: ${file.relativePath}. ${formatError(error)}`,
      );
    }
  }

  return rules;
}
