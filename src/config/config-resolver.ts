import { loadConfig } from "c12";
import { CliOptions } from "../core/config/types.js";
import { fileExists } from "../utils/file.js";
import { Config, ConfigParams } from "./config.js";

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve({
    targets = ["agentsmd"],
    features = ["*"],
    verbose = false,
    delete: isDelete = false,
    baseDirs = ["."],
    config: configPath = "rulesync.jsonc",
  }: CliOptions): Promise<Config> {
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
