import { ConfigResolver } from "../../config/config-resolver.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { logger } from "../../utils/logger.js";

export type InstallCommandOptions = {
  update?: boolean;
  frozen?: boolean;
  token?: string;
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
};

export async function installCommand(options: InstallCommandOptions): Promise<void> {
  logger.configure({
    verbose: options.verbose ?? false,
    silent: options.silent ?? false,
  });

  const config = await ConfigResolver.resolve({
    configPath: options.configPath,
    verbose: options.verbose,
    silent: options.silent,
  });

  const sources = config.getSources();

  if (sources.length === 0) {
    logger.warn("No sources defined in configuration. Nothing to install.");
    return;
  }

  logger.debug(`Installing from ${sources.length} source(s)...`);

  const result = await resolveAndFetchSources({
    sources,
    baseDir: process.cwd(),
    options: {
      updateSources: options.update,
      frozen: options.frozen,
      token: options.token,
    },
  });

  if (result.fetchedFileCount > 0) {
    logger.success(
      `Installed ${result.fetchedFileCount} file(s) from ${result.sourcesProcessed} source(s).`,
    );
  } else {
    logger.success(`All sources up to date (${result.sourcesProcessed} source(s) checked).`);
  }
}
