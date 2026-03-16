import { ConfigResolver } from "../../config/config-resolver.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { Logger } from "../../utils/logger.js";

export type InstallCommandOptions = {
  update?: boolean;
  frozen?: boolean;
  token?: string;
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
};

export async function installCommand(
  logger: Logger,
  options: InstallCommandOptions,
): Promise<void> {
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

  logger.debug(`Installing skills from ${sources.length} source(s)...`);

  const result = await resolveAndFetchSources({
    sources,
    baseDir: process.cwd(),
    options: {
      updateSources: options.update,
      frozen: options.frozen,
      token: options.token,
    },
  });

  // Capture JSON data if in JSON mode
  if (logger.jsonMode) {
    logger.captureData("sourcesProcessed", result.sourcesProcessed);
    logger.captureData("skillsFetched", result.fetchedSkillCount);
  }

  if (result.fetchedSkillCount > 0) {
    logger.success(
      `Installed ${result.fetchedSkillCount} skill(s) from ${result.sourcesProcessed} source(s).`,
    );
  } else {
    logger.success(`All skills up to date (${result.sourcesProcessed} source(s) checked).`);
  }
}
