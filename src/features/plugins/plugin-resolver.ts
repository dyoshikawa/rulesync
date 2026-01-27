import { Plugins } from "../../config/config.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { parsePluginIdentifier, ParsedPluginIdentifier } from "./plugin-identifier.js";
import { loadPluginFromLocal, LoadedPlugin } from "./plugin-loader.js";

/**
 * Result of resolving plugins.
 */
export type ResolvedPlugins = {
  /** Successfully loaded plugins */
  plugins: LoadedPlugin[];
  /** Errors encountered during resolution */
  errors: Array<{
    identifier: string;
    error: string;
  }>;
};

/**
 * Resolve and load all enabled plugins from configuration.
 *
 * @param plugins - Plugin configuration from rulesync.jsonc
 * @param baseDir - Base directory for resolving relative paths
 * @returns Resolved plugins and any errors
 */
export async function resolvePlugins(params: {
  plugins: Plugins;
  baseDir?: string;
}): Promise<ResolvedPlugins> {
  const { plugins, baseDir = process.cwd() } = params;
  const result: ResolvedPlugins = {
    plugins: [],
    errors: [],
  };

  // Get enabled plugins only
  const enabledPlugins = Object.entries(plugins).filter(([_, enabled]) => enabled);

  for (const [identifier] of enabledPlugins) {
    try {
      const plugin = await resolvePlugin({ identifier, baseDir });
      result.plugins.push(plugin);
      logger.info(`Loaded plugin: ${plugin.manifest.name} v${plugin.manifest.version}`);
    } catch (error) {
      const errorMessage = formatError(error);
      result.errors.push({ identifier, error: errorMessage });
      logger.warn(`Failed to load plugin '${identifier}': ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Resolve and load a single plugin from its identifier.
 *
 * @param identifier - Plugin identifier string
 * @param baseDir - Base directory for resolving relative paths
 * @returns Loaded plugin
 * @throws Error if plugin cannot be resolved or loaded
 */
export async function resolvePlugin(params: {
  identifier: string;
  baseDir?: string;
}): Promise<LoadedPlugin> {
  const { identifier, baseDir = process.cwd() } = params;

  const parsed = parsePluginIdentifier(identifier);
  if (!parsed) {
    throw new Error(
      `Invalid plugin identifier format: '${identifier}'. Expected format: 'name@source:path' (e.g., 'my-rules@local:../shared-rules')`,
    );
  }

  return await loadPluginBySource({ parsed, baseDir });
}

/**
 * Load a plugin based on its source type.
 *
 * @param parsed - Parsed plugin identifier
 * @param baseDir - Base directory for resolving relative paths
 * @returns Loaded plugin
 * @throws Error if source type is not supported or loading fails
 */
async function loadPluginBySource(params: {
  parsed: ParsedPluginIdentifier;
  baseDir: string;
}): Promise<LoadedPlugin> {
  const { parsed, baseDir } = params;

  switch (parsed.sourceType) {
    case "local":
      return await loadPluginFromLocal({
        pluginDir: parsed.sourcePath,
        baseDir,
      });

    case "github":
      // Phase 2: GitHub support will be implemented here
      throw new Error(
        `GitHub plugin source is not yet supported. Plugin: '${parsed.original}'. Please use local plugins for now (e.g., 'my-rules@local:./path/to/plugin').`,
      );

    case "url":
      // Phase 2: URL support will be implemented here
      throw new Error(
        `URL plugin source is not yet supported. Plugin: '${parsed.original}'. Please use local plugins for now (e.g., 'my-rules@local:./path/to/plugin').`,
      );

    default:
      throw new Error(`Unknown plugin source type: ${parsed.sourceType}`);
  }
}
