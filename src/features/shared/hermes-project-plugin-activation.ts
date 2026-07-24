import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_PATH,
  HERMESAGENT_DOTENV_FILE_PATH,
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

export function enableHermesProjectPluginsInDotenv(existingContent: string): string {
  const assignment = `${HERMESAGENT_PROJECT_PLUGINS_ENV_VAR}=true`;
  const matcher = new RegExp(
    `^(\\s*(?:export\\s+)?)${HERMESAGENT_PROJECT_PLUGINS_ENV_VAR}\\s*=.*$`,
  );
  const lines = existingContent.replaceAll("\r\n", "\n").split("\n");
  const result: string[] = [];
  let found = false;

  for (const line of lines) {
    const match = matcher.exec(line);
    if (!match) {
      result.push(line);
      continue;
    }
    if (found) {
      continue;
    }
    result.push(`${match[1] ?? ""}${assignment}`);
    found = true;
  }

  if (!found) {
    while (result.at(-1) === "") {
      result.pop();
    }
    result.push(assignment);
  }

  return `${result.join("\n").replace(/\n+$/u, "")}\n`;
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

  const homeDirectory = getHomeDirectory();
  const configPath = join(homeDirectory, HERMESAGENT_CONFIG_FILE_PATH);
  const dotenvPath = join(homeDirectory, HERMESAGENT_DOTENV_FILE_PATH);
  const existingConfig = (await readFileContentOrNull(configPath)) ?? "";
  const existingDotenv = (await readFileContentOrNull(dotenvPath)) ?? "";
  const expectedConfig = mergeEnabledPlugins({
    existingContent: existingConfig,
    filePath: configPath,
    pluginNames,
  });
  const expectedDotenv = enableHermesProjectPluginsInDotenv(existingDotenv);
  const paths: string[] = [];

  if (
    await writeActivationFile({
      filePath: configPath,
      relativePath: HERMESAGENT_CONFIG_FILE_PATH,
      expectedContent: expectedConfig,
      dryRun,
      logger,
    })
  ) {
    paths.push(HERMESAGENT_CONFIG_FILE_PATH);
  }
  if (
    await writeActivationFile({
      filePath: dotenvPath,
      relativePath: HERMESAGENT_DOTENV_FILE_PATH,
      expectedContent: expectedDotenv,
      dryRun,
      logger,
    })
  ) {
    paths.push(HERMESAGENT_DOTENV_FILE_PATH);
  }

  return { count: paths.length, paths, hasDiff: paths.length > 0 };
}
