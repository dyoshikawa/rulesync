import { join } from "node:path";

import { PluginMergeStrategy } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { LoadedPlugin } from "./plugin-loader.js";

/**
 * Represents a file to be merged from a plugin or local source.
 */
export type MergeableFile = {
  /** Source type: 'local' for .rulesync/, 'plugin' for plugin */
  source: "local" | "plugin";
  /** Plugin name (only for plugin source) */
  pluginName?: string;
  /** Relative path within the feature directory (e.g., 'coding-guidelines.md') */
  relativePath: string;
  /** Absolute path to the source file */
  absolutePath: string;
};

/**
 * Result of merging files.
 */
export type MergeResult = {
  /** Files to be used (after merge resolution) */
  files: MergeableFile[];
  /** Conflicts that were resolved */
  resolvedConflicts: Array<{
    relativePath: string;
    winner: "local" | "plugin";
    pluginName: string;
  }>;
  /** Errors encountered during merging */
  errors: string[];
};

/**
 * Merge local files with plugin files according to the merge strategy.
 *
 * @param localFiles - Files from .rulesync/ directory
 * @param pluginFiles - Files from plugins
 * @param strategy - Merge strategy to use
 * @returns Merged files and conflict resolution info
 */
export function mergeFiles(params: {
  localFiles: MergeableFile[];
  pluginFiles: MergeableFile[];
  strategy: PluginMergeStrategy;
}): MergeResult {
  const { localFiles, pluginFiles, strategy } = params;

  const result: MergeResult = {
    files: [],
    resolvedConflicts: [],
    errors: [],
  };

  // Build a map of relative paths to files
  const fileMap = new Map<string, MergeableFile>();

  // Add local files first
  for (const file of localFiles) {
    fileMap.set(file.relativePath, file);
  }

  // Process plugin files and handle conflicts
  for (const pluginFile of pluginFiles) {
    const existing = fileMap.get(pluginFile.relativePath);

    if (!existing) {
      // No conflict, add plugin file
      fileMap.set(pluginFile.relativePath, pluginFile);
      continue;
    }

    // Conflict detected
    if (existing.source === "plugin") {
      // Two plugins have the same file - this is always an error
      result.errors.push(
        `Conflict between plugins: '${existing.pluginName}' and '${pluginFile.pluginName}' both provide '${pluginFile.relativePath}'`,
      );
      continue;
    }

    // Conflict between local and plugin
    switch (strategy) {
      case "local-first":
        // Keep local file (already in map)
        result.resolvedConflicts.push({
          relativePath: pluginFile.relativePath,
          winner: "local",
          pluginName: pluginFile.pluginName ?? "unknown",
        });
        logger.debug(
          `Conflict resolved (local-first): '${pluginFile.relativePath}' - keeping local, ignoring plugin '${pluginFile.pluginName}'`,
        );
        break;

      case "plugin-first":
        // Replace with plugin file
        fileMap.set(pluginFile.relativePath, pluginFile);
        result.resolvedConflicts.push({
          relativePath: pluginFile.relativePath,
          winner: "plugin",
          pluginName: pluginFile.pluginName ?? "unknown",
        });
        logger.debug(
          `Conflict resolved (plugin-first): '${pluginFile.relativePath}' - using plugin '${pluginFile.pluginName}', ignoring local`,
        );
        break;

      case "error-on-conflict":
        result.errors.push(
          `Conflict between local '.rulesync/' and plugin '${pluginFile.pluginName}': both provide '${pluginFile.relativePath}'`,
        );
        break;
    }
  }

  result.files = Array.from(fileMap.values());
  return result;
}

/**
 * Convert loaded plugins to mergeable files.
 *
 * @param plugins - Loaded plugins
 * @param featureType - Type of feature to extract files for
 * @returns Array of mergeable files from all plugins
 */
export function pluginsToMergeableFiles(params: {
  plugins: LoadedPlugin[];
  featureType: "rules" | "commands" | "subagents";
}): MergeableFile[] {
  const { plugins, featureType } = params;
  const files: MergeableFile[] = [];

  for (const plugin of plugins) {
    let sourceFiles: string[];
    let featureDir: string;

    switch (featureType) {
      case "rules":
        sourceFiles = plugin.ruleFiles;
        featureDir = "rules";
        break;
      case "commands":
        sourceFiles = plugin.commandFiles;
        featureDir = "commands";
        break;
      case "subagents":
        sourceFiles = plugin.subagentFiles;
        featureDir = "subagents";
        break;
    }

    for (const relativePath of sourceFiles) {
      // Remove the feature directory prefix (e.g., 'rules/' from 'rules/coding.md')
      const pathWithoutFeatureDir = relativePath.startsWith(`${featureDir}/`)
        ? relativePath.slice(featureDir.length + 1)
        : relativePath;

      files.push({
        source: "plugin",
        pluginName: plugin.manifest.name,
        relativePath: pathWithoutFeatureDir,
        absolutePath: join(plugin.pluginDir, relativePath),
      });
    }
  }

  return files;
}
