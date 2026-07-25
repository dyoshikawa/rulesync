import { join, resolve } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_CONFIG_FILE_PATH,
  HERMESAGENT_PROJECT_PLUGINS_ENV_VAR,
} from "../../constants/hermesagent-paths.js";
import { fileContentsEquivalent } from "../../utils/content-equivalence.js";
import {
  addTrailingNewline,
  getHomeDirectory,
  readFileContentOrNull,
  writeFileContent,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { FeatureGenerateResult } from "../../utils/result.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { parseSharedConfig, stringifySharedConfig } from "./shared-config-gateway.js";

export const HERMES_PROJECT_PLUGIN_NAMES = [
  "rulesync-ignore",
  "rulesync-subagents",
  "rulesync-checks",
] as const;

export type HermesProjectPluginName = (typeof HERMES_PROJECT_PLUGIN_NAMES)[number];

function mergeEnabledPlugins({
  existingContent,
  filePath,
  pluginNames,
}: {
  existingContent: string;
  filePath: string;
  pluginNames: readonly HermesProjectPluginName[];
}): string {
  const config = parseSharedConfig({
    format: "yaml",
    fileContent: existingContent,
    filePath,
    invalidRootPolicy: "error",
  });
  const plugins = isPlainObject(config.plugins) ? config.plugins : {};
  const disabled = Array.isArray(plugins.disabled)
    ? plugins.disabled.filter((value): value is string => typeof value === "string")
    : [];
  const conflicts = pluginNames.filter((pluginName) => disabled.includes(pluginName));

  if (conflicts.length > 0) {
    throw new Error(
      `Cannot activate Hermes project plugin(s) ${conflicts.join(", ")} because ` +
        `${filePath} explicitly lists them in plugins.disabled. Remove the conflicting ` +
        "entries or exclude those RuleSync features.",
    );
  }

  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];
  return stringifySharedConfig({
    format: "yaml",
    document: {
      ...config,
      plugins: {
        ...plugins,
        enabled: Array.from(new Set([...enabled, ...pluginNames])),
      },
    },
  });
}

async function writeActivationFile({
  filePath,
  relativePath,
  expectedContent,
  dryRun,
  logger,
}: {
  filePath: string;
  relativePath: string;
  expectedContent: string;
  dryRun: boolean;
  logger: Logger;
}): Promise<boolean> {
  const existingContent = await readFileContentOrNull(filePath);
  const normalizedExpected = addTrailingNewline(expectedContent);
  if (
    fileContentsEquivalent({
      filePath,
      expected: normalizedExpected,
      existing: existingContent,
    })
  ) {
    return false;
  }

  if (dryRun) {
    logger.info(`[DRY RUN] Would write: ${filePath}`);
  } else {
    await writeFileContent(filePath, normalizedExpected);
  }
  logger.debug(`Hermes project-plugin activation requires ${relativePath}`);
  return true;
}

export async function activateHermesProjectPlugins({
  pluginNames,
  dryRun,
  logger,
}: {
  pluginNames: readonly HermesProjectPluginName[];
  dryRun: boolean;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  if (pluginNames.length === 0) {
    return { count: 0, paths: [], hasDiff: false };
  }

  const configuredHermesHome = process.env.HERMES_HOME?.trim();
  const configRoot = configuredHermesHome ? resolve(configuredHermesHome) : getHomeDirectory();
  const relativeConfigPath = configuredHermesHome
    ? HERMESAGENT_CONFIG_FILE_NAME
    : HERMESAGENT_CONFIG_FILE_PATH;
  const configPath = join(configRoot, relativeConfigPath);
  const existingConfig = (await readFileContentOrNull(configPath)) ?? "";
  const expectedConfig = mergeEnabledPlugins({
    existingContent: existingConfig,
    filePath: configPath,
    pluginNames,
  });
  const paths: string[] = [];

  logger.warn(
    "Hermes project plugins require explicit trust. Run Hermes from this trusted repository " +
      `with ${HERMESAGENT_PROJECT_PLUGINS_ENV_VAR}=true. RuleSync does not persist this ` +
      "global setting.",
  );

  if (
    await writeActivationFile({
      filePath: configPath,
      relativePath: relativeConfigPath,
      expectedContent: expectedConfig,
      dryRun,
      logger,
    })
  ) {
    paths.push(relativeConfigPath);
  }

  return { count: paths.length, paths, hasDiff: paths.length > 0 };
}
