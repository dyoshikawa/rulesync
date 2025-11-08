import { resolve } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { formatError } from "../utils/error.js";
import {
  fileExists,
  getHomeDirectory,
  readFileContent,
  resolvePath,
  validateBaseDir,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import {
  Config,
  ConfigParams,
  PartialConfigParams,
  PartialConfigParamsSchema,
  RequiredConfigParams,
} from "./config.js";

export type ConfigResolverResolveParams = Partial<
  ConfigParams & {
    configPath: string;
  }
>;

const defaults: RequiredConfigParams & { configPath: string } = {
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
    // Validate configPath to prevent path traversal attacks
    const validatedConfigPath = resolvePath(configPath, process.cwd());

    let configByFile: PartialConfigParams = {};
    if (await fileExists(validatedConfigPath)) {
      try {
        const fileContent = await readFileContent(validatedConfigPath);
        const jsonData = parseJsonc(fileContent);
        configByFile = PartialConfigParamsSchema.parse(jsonData);
      } catch (error) {
        logger.error(`Failed to load config file: ${formatError(error)}`);
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
  if (global) {
    // When global is true, the base directory is always the home directory
    return [getHomeDirectory()];
  }

  const resolvedBaseDirs = baseDirs.map((baseDir) => resolve(baseDir));

  // Validate each baseDir for security
  resolvedBaseDirs.forEach((baseDir) => {
    validateBaseDir(baseDir);
  });

  return resolvedBaseDirs;
}
