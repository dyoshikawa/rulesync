import { join, resolve } from "node:path";

import { formatError } from "../../utils/error.js";
import { fileExists, findFilesByGlobs, readFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import {
  PLUGIN_MANIFEST_FILE_NAME,
  PluginManifest,
  PluginManifestSchema,
} from "./plugin-manifest.js";

/**
 * Represents loaded plugin content.
 */
export type LoadedPlugin = {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Absolute path to the plugin directory */
  pluginDir: string;
  /** Relative paths to rule files (e.g., rules/*.md) */
  ruleFiles: string[];
  /** Relative paths to command files (e.g., commands/*.md) */
  commandFiles: string[];
  /** Relative paths to subagent files (e.g., subagents/*.md) */
  subagentFiles: string[];
  /** Relative paths to skill directories (e.g., skills/name/SKILL.md) */
  skillDirs: string[];
  /** Path to MCP configuration file if exists */
  mcpConfigPath: string | null;
  /** Path to ignore file if exists */
  ignoreFilePath: string | null;
};

/**
 * Load a plugin from a local directory.
 *
 * @param pluginDir - Absolute or relative path to the plugin directory
 * @param baseDir - Base directory for resolving relative paths
 * @returns Loaded plugin content
 * @throws Error if plugin directory doesn't exist or manifest is invalid
 */
export async function loadPluginFromLocal(params: {
  pluginDir: string;
  baseDir?: string;
}): Promise<LoadedPlugin> {
  const { pluginDir, baseDir = process.cwd() } = params;
  const absolutePluginDir = resolve(baseDir, pluginDir);

  // Check if plugin directory exists
  if (!(await fileExists(absolutePluginDir))) {
    throw new Error(`Plugin directory not found: ${absolutePluginDir}`);
  }

  // Load and validate manifest
  const manifestPath = join(absolutePluginDir, PLUGIN_MANIFEST_FILE_NAME);
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Plugin manifest not found: ${manifestPath}`);
  }

  const manifestContent = await readFileContent(manifestPath);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestContent);
  } catch {
    throw new Error(`Invalid JSON in plugin manifest: ${manifestPath}`);
  }

  const manifestResult = PluginManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    throw new Error(
      `Invalid plugin manifest: ${manifestPath}. ${formatError(manifestResult.error)}`,
    );
  }

  const manifest = manifestResult.data;
  logger.debug(`Loaded plugin manifest: ${manifest.name} v${manifest.version}`);

  // Discover plugin content
  const ruleFiles = await discoverFiles(absolutePluginDir, "rules/**/*.md");
  const commandFiles = await discoverFiles(absolutePluginDir, "commands/**/*.md");
  const subagentFiles = await discoverFiles(absolutePluginDir, "subagents/**/*.md");
  const skillDirs = await discoverSkillDirs(absolutePluginDir);

  // Check for MCP and ignore files
  const mcpConfigPath = (await fileExists(join(absolutePluginDir, "mcp.json")))
    ? join(absolutePluginDir, "mcp.json")
    : null;
  const ignoreFilePath = (await fileExists(join(absolutePluginDir, ".rulesyncignore")))
    ? join(absolutePluginDir, ".rulesyncignore")
    : null;

  return {
    manifest,
    pluginDir: absolutePluginDir,
    ruleFiles,
    commandFiles,
    subagentFiles,
    skillDirs,
    mcpConfigPath,
    ignoreFilePath,
  };
}

/**
 * Discover files matching a glob pattern in a directory.
 *
 * @param baseDir - Base directory to search in
 * @param pattern - Glob pattern to match
 * @returns Array of relative file paths
 */
async function discoverFiles(baseDir: string, pattern: string): Promise<string[]> {
  try {
    const absolutePaths = await findFilesByGlobs(join(baseDir, pattern));
    // Convert to relative paths from baseDir
    return absolutePaths.map((absPath) => absPath.slice(baseDir.length + 1));
  } catch {
    return [];
  }
}

/**
 * Discover skill directories in a plugin.
 * Skills are directories containing SKILL.md files.
 *
 * @param baseDir - Base directory to search in
 * @returns Array of skill directory names
 */
async function discoverSkillDirs(baseDir: string): Promise<string[]> {
  try {
    const skillFiles = await findFilesByGlobs(join(baseDir, "skills/*/SKILL.md"));
    // Extract directory names
    return skillFiles.map((absPath) => {
      const relativePath = absPath.slice(baseDir.length + 1);
      // Extract the skill directory name from skills/name/SKILL.md
      const parts = relativePath.split("/");
      return parts[1] ?? "";
    });
  } catch {
    return [];
  }
}
