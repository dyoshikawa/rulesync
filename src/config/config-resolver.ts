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
  features: ["rules", "ignore", "mcp", "subagents", "commands"],
  verbose: false,
  delete: false,
  baseDirs: ["."],
  configPath: "rulesync.jsonc",
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
  }: ConfigResolverResolveParams): Promise<Config> {
    if (!(await fileExists(configPath))) {
      return new Config({
        targets: targets ?? defaults.targets,
        features: features ?? defaults.features,
        verbose: verbose ?? defaults.verbose,
        delete: isDelete ?? defaults.delete,
        baseDirs: baseDirs ?? defaults.baseDirs,
      });
    }

    const loadOptions: Parameters<typeof loadConfig>[0] = {
      name: "rulesync",
      cwd: process.cwd(),
      rcFile: false, // Disable rc file lookup
      configFile: configPath || "rulesync", // Use provided configPath or default
    };

    const loadConfigResult = await loadConfig<Partial<ConfigParams>>(loadOptions);
    const configByFile = loadConfigResult?.config || {};

    const configParams = {
      targets: targets ?? configByFile.targets ?? defaults.targets,
      features: features ?? configByFile.features ?? defaults.features,
      verbose: verbose ?? configByFile.verbose ?? defaults.verbose,
      delete: isDelete ?? configByFile.delete ?? defaults.delete,
      baseDirs: baseDirs ?? configByFile.baseDirs ?? defaults.baseDirs,
    };
    return new Config(configParams);
  }
}
