import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { fileExists, getHomeDirectory, readFileContent, validateBaseDir } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { isEnvTest } from "../utils/vitest.js";
import { Config, ConfigParams } from "./config.js";

export type ConfigResolverResolveParams = Partial<
  ConfigParams & {
    configPath: string;
  }
>;

const defaults: Required<ConfigResolverResolveParams> = {
  targets: ["agentsmd"],
  features: ["rules"],
  verbose: false,
  delete: false,
  baseDirs: [process.cwd()],
  configPath: "rulesync.jsonc",
  global: false,
  simulatedCommands: false,
  simulatedSubagents: false,
  modularMcp: false,
  experimentalGlobal: false,
  experimentalSimulateCommands: false,
  experimentalSimulateSubagents: false,
};

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve({
    targets,
    features,
    verbose,
    delete: isDelete,
    baseDirs,
    configPath = defaults.configPath,
    global,
    simulatedCommands,
    simulatedSubagents,
    modularMcp,
    experimentalGlobal,
    experimentalSimulateCommands,
    experimentalSimulateSubagents,
  }: ConfigResolverResolveParams): Promise<Config> {
    if (!(await fileExists(configPath))) {
      // Warn about deprecated experimental options
      if (experimentalGlobal !== undefined) {
        warnDeprecatedOptions({ experimentalGlobal });
      }
      if (experimentalSimulateCommands !== undefined) {
        warnDeprecatedOptions({ experimentalSimulateCommands });
      }
      if (experimentalSimulateSubagents !== undefined) {
        warnDeprecatedOptions({ experimentalSimulateSubagents });
      }

      // Resolve options with migration logic
      const resolvedGlobal = global ?? experimentalGlobal ?? defaults.global;
      const resolvedSimulatedCommands =
        simulatedCommands ?? experimentalSimulateCommands ?? defaults.simulatedCommands;
      const resolvedSimulatedSubagents =
        simulatedSubagents ?? experimentalSimulateSubagents ?? defaults.simulatedSubagents;

      return new Config({
        targets: targets ?? defaults.targets,
        features: features ?? defaults.features,
        verbose: verbose ?? defaults.verbose,
        delete: isDelete ?? defaults.delete,
        baseDirs: getBaseDirsInLightOfGlobal({
          baseDirs: baseDirs ?? defaults.baseDirs,
          global: resolvedGlobal,
        }),
        global: resolvedGlobal,
        simulatedCommands: resolvedSimulatedCommands,
        simulatedSubagents: resolvedSimulatedSubagents,
        modularMcp: modularMcp ?? defaults.modularMcp,
      });
    }

    // Load and parse the config file
    let configByFile: Partial<ConfigParams> = {};
    try {
      const fileContent = await readFileContent(configPath);
      const parsed = parseJsonc(fileContent);
      // oxlint-disable-next-line no-type-assertion
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      configByFile = parsed ? (parsed as Partial<ConfigParams>) : {};
    } catch (error) {
      // If file doesn't exist or can't be read, use default values
      // Parse errors will still be thrown
      const isFileNotFoundError =
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR");

      if (isFileNotFoundError) {
        logger.warn(`Config file not found: ${configPath}, using default values`);
        configByFile = {};
      } else {
        // For other errors (parse errors, permission errors, etc.), throw
        if (error instanceof Error) {
          logger.error(`Failed to load config file: ${error.message}`);
        }
        throw error;
      }
    }

    // Warn about deprecated experimental options from both CLI and config file
    const deprecatedGlobal = experimentalGlobal ?? configByFile.experimentalGlobal;
    const deprecatedCommands =
      experimentalSimulateCommands ?? configByFile.experimentalSimulateCommands;
    const deprecatedSubagents =
      experimentalSimulateSubagents ?? configByFile.experimentalSimulateSubagents;

    if (deprecatedGlobal !== undefined) {
      warnDeprecatedOptions({ experimentalGlobal: deprecatedGlobal });
    }
    if (deprecatedCommands !== undefined) {
      warnDeprecatedOptions({ experimentalSimulateCommands: deprecatedCommands });
    }
    if (deprecatedSubagents !== undefined) {
      warnDeprecatedOptions({ experimentalSimulateSubagents: deprecatedSubagents });
    }

    // Resolve options with migration logic (new options take priority over experimental ones)
    const resolvedGlobal =
      global ??
      configByFile.global ??
      experimentalGlobal ??
      configByFile.experimentalGlobal ??
      defaults.global;
    const resolvedSimulatedCommands =
      simulatedCommands ??
      configByFile.simulatedCommands ??
      experimentalSimulateCommands ??
      configByFile.experimentalSimulateCommands ??
      defaults.simulatedCommands;
    const resolvedSimulatedSubagents =
      simulatedSubagents ??
      configByFile.simulatedSubagents ??
      experimentalSimulateSubagents ??
      configByFile.experimentalSimulateSubagents ??
      defaults.simulatedSubagents;

    const configParams = {
      targets: targets ?? configByFile.targets ?? defaults.targets,
      features: features ?? configByFile.features ?? defaults.features,
      verbose: verbose ?? configByFile.verbose ?? defaults.verbose,
      delete: isDelete ?? configByFile.delete ?? defaults.delete,
      baseDirs: getBaseDirsInLightOfGlobal({
        baseDirs: baseDirs ?? configByFile.baseDirs ?? defaults.baseDirs,
        global: resolvedGlobal,
      }),
      global: resolvedGlobal,
      simulatedCommands: resolvedSimulatedCommands,
      simulatedSubagents: resolvedSimulatedSubagents,
      modularMcp: modularMcp ?? configByFile.modularMcp ?? defaults.modularMcp,
    };
    return new Config(configParams);
  }
}

function warnDeprecatedOptions({
  experimentalGlobal,
  experimentalSimulateCommands,
  experimentalSimulateSubagents,
}: {
  experimentalGlobal?: boolean;
  experimentalSimulateCommands?: boolean;
  experimentalSimulateSubagents?: boolean;
}): void {
  if (experimentalGlobal !== undefined) {
    logger.warn("'experimentalGlobal' option is deprecated. Please use 'global' instead.");
  }
  if (experimentalSimulateCommands !== undefined) {
    logger.warn(
      "'experimentalSimulateCommands' option is deprecated. Please use 'simulatedCommands' instead.",
    );
  }
  if (experimentalSimulateSubagents !== undefined) {
    logger.warn(
      "'experimentalSimulateSubagents' option is deprecated. Please use 'simulatedSubagents' instead.",
    );
  }
}

function getBaseDirsInLightOfGlobal({
  baseDirs,
  global,
}: {
  baseDirs: string[];
  global: boolean;
}): string[] {
  if (isEnvTest) {
    // When in test environment, the base directory is always the relative directory from the project root
    return baseDirs.map((baseDir) => join(".", baseDir));
  }

  if (global) {
    // When global is true, the base directory is always the home directory
    return [getHomeDirectory()];
  }

  // Validate each baseDir for security
  baseDirs.forEach((baseDir) => {
    validateBaseDir(baseDir);
  });

  return baseDirs;
}
