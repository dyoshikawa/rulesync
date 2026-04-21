import { ConfigResolver } from "../../config/config-resolver.js";
import { installApm } from "../../lib/apm/apm-install.js";
import { apmManifestExists } from "../../lib/apm/apm-manifest.js";
import { installGh } from "../../lib/gh/gh-install.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import type { Logger } from "../../utils/logger.js";

export const INSTALL_MODES = ["rulesync", "apm", "gh"] as const;
export type InstallMode = (typeof INSTALL_MODES)[number];

export type InstallCommandOptions = {
  mode?: InstallMode;
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
  const mode: InstallMode = options.mode ?? "rulesync";

  if (mode === "gh") {
    await runGhInstall(logger, options);
    return;
  }

  if (mode === "apm") {
    await runApmInstall(logger, options);
    return;
  }

  await runRulesyncInstall(logger, options);
}

async function runRulesyncInstall(logger: Logger, options: InstallCommandOptions): Promise<void> {
  const baseDir = process.cwd();

  // If both apm.yml and rulesync.jsonc sources are defined, refuse to guess.
  // `--mode apm` is required to opt into the APM layout.
  const apmExists = await apmManifestExists(baseDir);

  const config = await ConfigResolver.resolve({
    configPath: options.configPath,
    verbose: options.verbose,
    silent: options.silent,
  });
  const sources = config.getSources();

  if (apmExists && sources.length > 0) {
    throw new Error(
      "Both apm.yml and rulesync.jsonc `sources` are defined. Pass --mode apm or --mode rulesync to disambiguate.",
    );
  }

  if (sources.length === 0) {
    if (apmExists) {
      logger.warn(
        "No sources defined in rulesync.jsonc, but apm.yml is present. Did you mean --mode apm?",
      );
      return;
    }
    logger.warn("No sources defined in configuration. Nothing to install.");
    return;
  }

  logger.debug(`Installing skills from ${sources.length} source(s)...`);

  const result = await resolveAndFetchSources({
    sources,
    baseDir,
    options: {
      updateSources: options.update,
      frozen: options.frozen,
      token: options.token,
    },
    logger,
  });

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

async function runApmInstall(logger: Logger, options: InstallCommandOptions): Promise<void> {
  const baseDir = process.cwd();

  if (!(await apmManifestExists(baseDir))) {
    throw new Error(
      "--mode apm requires an apm.yml at the project root. Create one or drop --mode apm to fall back to rulesync mode.",
    );
  }

  const result = await installApm({
    baseDir,
    options: {
      update: options.update,
      frozen: options.frozen,
      token: options.token,
    },
    logger,
  });

  if (logger.jsonMode) {
    logger.captureData("dependenciesProcessed", result.dependenciesProcessed);
    logger.captureData("deployedFileCount", result.deployedFileCount);
    logger.captureData("failedDependencyCount", result.failedDependencyCount);
  }

  if (result.failedDependencyCount > 0) {
    throw new Error(
      `Failed to install ${result.failedDependencyCount} of ${result.dependenciesProcessed} apm dependency(ies). See the log above for details.`,
    );
  }

  if (result.deployedFileCount > 0) {
    logger.success(
      `Installed ${result.deployedFileCount} file(s) from ${result.dependenciesProcessed} apm dependency(ies).`,
    );
  } else {
    logger.success(`All apm dependencies up to date (${result.dependenciesProcessed} checked).`);
  }
}

async function runGhInstall(logger: Logger, options: InstallCommandOptions): Promise<void> {
  const baseDir = process.cwd();

  // gh mode reads sources from `rulesync.jsonc`, never from `apm.yml`. The
  // disambiguation between rulesync/apm modes lives in `runRulesyncInstall`;
  // here the user has already opted into gh mode explicitly.
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

  const result = await installGh({
    baseDir,
    sources,
    options: {
      update: options.update,
      frozen: options.frozen,
      token: options.token,
    },
    logger,
  });

  if (logger.jsonMode) {
    logger.captureData("sourcesProcessed", result.sourcesProcessed);
    logger.captureData("installedSkillCount", result.installedSkillCount);
    logger.captureData("failedSourceCount", result.failedSourceCount);
  }

  if (result.failedSourceCount > 0) {
    throw new Error(
      `Failed to install ${result.failedSourceCount} of ${result.sourcesProcessed} gh source(s). See the log above for details.`,
    );
  }

  if (result.installedSkillCount > 0) {
    logger.success(
      `Installed ${result.installedSkillCount} skill(s) from ${result.sourcesProcessed} gh source(s).`,
    );
  } else {
    logger.success(`All gh sources up to date (${result.sourcesProcessed} checked).`);
  }
}
