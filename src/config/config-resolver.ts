import { join } from "node:path";
import { loadConfig } from "c12";
import { fileExists, getHomeDirectory } from "../utils/file.js";
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
  baseDirs: ["."],
  configPath: "rulesync.jsonc",
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
    experimentalGlobal,
    experimentalSimulateCommands,
    experimentalSimulateSubagents,
  }: ConfigResolverResolveParams): Promise<Config> {
    if (!fileExists(configPath)) {
      return new Config({
        targets: targets ?? defaults.targets,
        features: features ?? defaults.features,
        verbose: verbose ?? defaults.verbose,
        delete: isDelete ?? defaults.delete,
        baseDirs: getBaseDirsInLightOfGlobal({
          baseDirs: baseDirs ?? defaults.baseDirs,
          global: experimentalGlobal ?? false,
        }),
        experimentalGlobal: experimentalGlobal ?? defaults.experimentalGlobal,
        experimentalSimulateCommands:
          experimentalSimulateCommands ?? defaults.experimentalSimulateCommands,
        experimentalSimulateSubagents:
          experimentalSimulateSubagents ?? defaults.experimentalSimulateSubagents,
      });
    }

    const loadOptions: Parameters<typeof loadConfig>[0] = {
      name: "rulesync",
      cwd: process.cwd(),
      rcFile: false, // Disable rc file lookup
      configFile: "rulesync", // Will look for rulesync.jsonc, rulesync.ts, etc.
    };

    if (configPath) {
      loadOptions.configFile = configPath;
    }

    const { config: configByFile } = await loadConfig<Partial<ConfigParams>>(loadOptions);

    const configParams = {
      targets: targets ?? configByFile.targets ?? defaults.targets,
      features: features ?? configByFile.features ?? defaults.features,
      verbose: verbose ?? configByFile.verbose ?? defaults.verbose,
      delete: isDelete ?? configByFile.delete ?? defaults.delete,
      baseDirs: getBaseDirsInLightOfGlobal({
        baseDirs: baseDirs ?? configByFile.baseDirs ?? defaults.baseDirs,
        global: experimentalGlobal ?? false,
      }),
      experimentalGlobal:
        experimentalGlobal ?? configByFile.experimentalGlobal ?? defaults.experimentalGlobal,
      experimentalSimulateCommands:
        experimentalSimulateCommands ??
        configByFile.experimentalSimulateCommands ??
        defaults.experimentalSimulateCommands,
      experimentalSimulateSubagents:
        experimentalSimulateSubagents ??
        configByFile.experimentalSimulateSubagents ??
        defaults.experimentalSimulateSubagents,
    };
    return new Config(configParams);
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

  return baseDirs;
}
