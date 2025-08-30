import { loadConfig } from "c12";
import { fileExists } from "../utils/file.js";
import { Config, ConfigParams } from "./config.js";

export type ConfigResolverResolveParams = Partial<
  ConfigParams & {
    configPath: string;
  }
>;

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve({
    targets = ["agentsmd"],
    features = ["*"],
    verbose = false,
    delete: isDelete = false,
    baseDirs = ["."],
    configPath = "rulesync.jsonc",
  }: ConfigResolverResolveParams): Promise<Config> {
    if (!fileExists(configPath)) {
      return new Config({
        targets,
        features,
        verbose,
        delete: isDelete,
        baseDirs,
      });
    }

    const loadOptions: Parameters<typeof loadConfig>[0] = {
      name: "rulesync",
      cwd: process.cwd(),
      rcFile: false, // Disable rc file lookup
      configFile: "rulesync", // Will look for rulesync.jsonc, rulesync.ts, etc.
      defaults: {
        targets,
        features,
        verbose,
        delete: isDelete,
        baseDirs,
      },
    };

    if (configPath) {
      loadOptions.configFile = configPath;
    }

    const { config: configByFile } = await loadConfig<Partial<ConfigParams>>(loadOptions);

    const configParams = {
      targets: targets ?? configByFile.targets,
      features: features ?? configByFile.features,
      verbose: verbose ?? configByFile.verbose,
      delete: isDelete ?? configByFile.delete,
      baseDirs: baseDirs ?? configByFile.baseDirs,
    };
    return new Config(configParams);
  }
}
