import { loadConfig } from "c12";
import { fileExists } from "../utils/file.js";
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
  experimentalSimulateCommands: false,
  experimentalSimutateSubagents: false,
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
    experimentalSimulateCommands,
    experimentalSimutateSubagents,
  }: ConfigResolverResolveParams): Promise<Config> {
    if (!fileExists(configPath)) {
      return new Config({
        targets: targets ?? defaults.targets,
        features: features ?? defaults.features,
        verbose: verbose ?? defaults.verbose,
        delete: isDelete ?? defaults.delete,
        baseDirs: baseDirs ?? defaults.baseDirs,
        experimentalSimulateCommands:
          experimentalSimulateCommands ?? defaults.experimentalSimulateCommands,
        experimentalSimutateSubagents:
          experimentalSimutateSubagents ?? defaults.experimentalSimutateSubagents,
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
      baseDirs: baseDirs ?? configByFile.baseDirs ?? defaults.baseDirs,
      experimentalSimulateCommands:
        experimentalSimulateCommands ??
        configByFile.experimentalSimulateCommands ??
        defaults.experimentalSimulateCommands,
      experimentalSimutateSubagents:
        experimentalSimutateSubagents ??
        configByFile.experimentalSimutateSubagents ??
        defaults.experimentalSimutateSubagents,
    };
    return new Config(configParams);
  }
}
