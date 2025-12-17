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
  ConfigFile,
  ConfigFileSchema,
  ConfigParams,
  PartialConfigParams,
  RequiredConfigParams,
} from "./config.js";

export type ConfigResolverResolveParams = Partial<
  ConfigParams & {
    configPath: string;
  }
>;

const getDefaults = (): RequiredConfigParams & { configPath: string } => ({
  targets: ["agentsmd"],
  features: ["rules"],
  verbose: false,
  delete: false,
  baseDirs: [process.cwd()],
  configPath: "rulesync.jsonc",
  global: false,
  simulateCommands: false,
  simulateSubagents: false,
  simulateSkills: false,
  modularMcp: false,
  check: false,
  experimentalGlobal: false,
  experimentalSimulateCommands: false,
  experimentalSimulateSubagents: false,
});

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve({
    targets,
    features,
    verbose,
    delete: isDelete,
    baseDirs,
    configPath = getDefaults().configPath,
    global,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    modularMcp,
    check,
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
        // Parse with ConfigFileSchema to allow $schema property, then extract config params
        const parsed: ConfigFile = ConfigFileSchema.parse(jsonData);
        // Exclude $schema from config params
        const { $schema: _schema, ...configParams } = parsed;
        configByFile = configParams;
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
      getDefaults().global;
    const resolvedSimulateCommands =
      simulateCommands ??
      configByFile.simulateCommands ??
      experimentalSimulateCommands ??
      configByFile.experimentalSimulateCommands ??
      getDefaults().simulateCommands;
    const resolvedSimulateSubagents =
      simulateSubagents ??
      configByFile.simulateSubagents ??
      experimentalSimulateSubagents ??
      configByFile.experimentalSimulateSubagents ??
      getDefaults().simulateSubagents;

    const resolvedSimulateSkills =
      simulateSkills ?? configByFile.simulateSkills ?? getDefaults().simulateSkills;

    const configParams = {
      targets: targets ?? configByFile.targets ?? getDefaults().targets,
      features: features ?? configByFile.features ?? getDefaults().features,
      verbose: verbose ?? configByFile.verbose ?? getDefaults().verbose,
      delete: isDelete ?? configByFile.delete ?? getDefaults().delete,
      baseDirs: getBaseDirsInLightOfGlobal({
        baseDirs: baseDirs ?? configByFile.baseDirs ?? getDefaults().baseDirs,
        global: resolvedGlobal,
      }),
      global: resolvedGlobal,
      simulateCommands: resolvedSimulateCommands,
      simulateSubagents: resolvedSimulateSubagents,
      simulateSkills: resolvedSimulateSkills,
      modularMcp: modularMcp ?? configByFile.modularMcp ?? getDefaults().modularMcp,
      check: check ?? configByFile.check ?? getDefaults().check,
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
      "'experimentalSimulateCommands' option is deprecated. Please use 'simulateCommands' instead.",
    );
  }
  if (experimentalSimulateSubagents !== undefined) {
    logger.warn(
      "'experimentalSimulateSubagents' option is deprecated. Please use 'simulateSubagents' instead.",
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
