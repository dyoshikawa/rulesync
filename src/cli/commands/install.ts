import { ConfigResolver } from "../../config/config-resolver.js";
import { installApm } from "../../lib/apm/apm-install.js";
import { apmManifestExists } from "../../lib/apm/apm-manifest.js";
import { installGh, validateGhOptions } from "../../lib/gh/gh-install.js";
import { checkOutdatedSources } from "../../lib/sources-outdated.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";

export const INSTALL_MODES = ["rulesync", "apm", "gh"] as const;
export type InstallMode = (typeof INSTALL_MODES)[number];

export type InstallCommandOptions = {
  mode?: InstallMode;
  update?: boolean;
  frozen?: boolean;
  outdated?: boolean;
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

  if (options.outdated) {
    if (mode !== "rulesync") {
      throw new Error("--outdated is only supported in rulesync mode.");
    }
    if (options.update || options.frozen) {
      throw new Error("--outdated cannot be combined with --update or --frozen.");
    }
    await runOutdatedCheck(logger, options);
    return;
  }

  if (mode === "gh") {
    validateGhOptions(options);
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
  const projectRoot = process.cwd();

  // If both apm.yml and rulesync.jsonc sources are defined, refuse to guess.
  // `--mode apm` is required to opt into the APM layout.
  const apmExists = await apmManifestExists(projectRoot);

  const config = await ConfigResolver.resolve(
    {
      configPath: options.configPath,
      verbose: options.verbose,
      silent: options.silent,
    },
    { logger },
  );
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
    logger.warn("No sources defined in configuration. Removing stale source artifacts.");
  }

  logger.debug(`Installing rules and skills from ${sources.length} source(s)...`);

  const result = await resolveAndFetchSources({
    sources,
    projectRoot,
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
    logger.captureData("rulesFetched", result.fetchedRuleCount);
    logger.captureData("failedSourceCount", result.failedSourceCount);
  }

  if (result.failedSourceCount > 0) {
    throw new Error(
      `Failed to install ${result.failedSourceCount} of ${result.sourcesProcessed} rulesync source(s). See the log above for details.`,
    );
  }

  if (result.fetchedSkillCount > 0 || result.fetchedRuleCount > 0) {
    logger.success(
      `Installed ${result.fetchedSkillCount} skill(s) and ${result.fetchedRuleCount} rule(s) from ${result.sourcesProcessed} source(s).`,
    );
  } else {
    logger.success(
      `All source artifacts up to date (${result.sourcesProcessed} source(s) checked).`,
    );
  }
}

/** Exit code of `install --outdated` when a source could not be resolved. */
export const OUTDATED_RESOLUTION_FAILED_EXIT_CODE = 2;

async function runOutdatedCheck(logger: Logger, options: InstallCommandOptions): Promise<void> {
  const config = await ConfigResolver.resolve(
    {
      configPath: options.configPath,
      verbose: options.verbose,
      silent: options.silent,
    },
    { logger },
  );
  const sources = config.getSources();

  if (sources.length === 0) {
    logger.warn("No sources defined in configuration. Nothing to check.");
    return;
  }

  const reports = await checkOutdatedSources({
    sources,
    projectRoot: process.cwd(),
    token: options.token,
    logger,
  });

  if (logger.jsonMode) {
    logger.captureData("sources", reports);
  }

  for (const report of reports) {
    const label = `${report.source} (${report.requestedRef ?? "unresolved"})`;
    switch (report.status) {
      case "up-to-date":
        logger.info(`up to date  ${label}: ${report.lockedRef}`);
        break;
      case "outdated":
        logger.warn(`outdated    ${label}: ${report.lockedRef} -> ${report.latestRef}`);
        break;
      case "not-locked":
        logger.warn(`not locked  ${label}: -> ${report.latestRef}`);
        break;
      case "failed":
        // `warn`, not `error`: in `--json` mode `error` emits a whole document.
        logger.warn(`failed      ${report.source}: ${report.error}`);
        break;
    }
  }

  const failed = reports.filter((report) => report.status === "failed").length;
  const behind = reports.filter(
    (report) => report.status === "outdated" || report.status === "not-locked",
  ).length;

  if (failed > 0) {
    throw new CLIError(
      `Could not resolve ${failed} of ${reports.length} source(s); their lockfile status is unknown.`,
      ErrorCodes.INSTALL_FAILED,
      OUTDATED_RESOLUTION_FAILED_EXIT_CODE,
      { sources: reports },
    );
  }
  if (behind > 0) {
    throw new CLIError(
      `${behind} of ${reports.length} source(s) are behind in the lockfile or missing from it. Run 'rulesync install --update' to update.`,
      ErrorCodes.INSTALL_FAILED,
      1,
      { sources: reports },
    );
  }
  logger.success(`All ${reports.length} source(s) are up to date with the lockfile.`);
}

async function runApmInstall(logger: Logger, options: InstallCommandOptions): Promise<void> {
  const projectRoot = process.cwd();

  if (!(await apmManifestExists(projectRoot))) {
    throw new Error(
      "--mode apm requires an apm.yml at the project root. Create one or drop --mode apm to fall back to rulesync mode.",
    );
  }

  const result = await installApm({
    projectRoot,
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
  const projectRoot = process.cwd();

  // gh mode reads sources from `rulesync.jsonc`, never from `apm.yml`. The
  // disambiguation between rulesync/apm modes lives in `runRulesyncInstall`;
  // here the user has already opted into gh mode explicitly.
  const config = await ConfigResolver.resolve(
    {
      configPath: options.configPath,
      verbose: options.verbose,
      silent: options.silent,
    },
    { logger },
  );
  const sources = config.getSources();

  if (sources.length === 0) {
    logger.warn("No sources defined in configuration. Nothing to install.");
    return;
  }

  const result = await installGh({
    projectRoot,
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
    logger.captureData("failedSourceCount", result.failedSourceCount);
  }

  if (result.failedSourceCount > 0) {
    throw new Error(
      `Failed to install ${result.failedSourceCount} of ${result.sourcesProcessed} gh source(s). See the log above for details.`,
    );
  }

  logger.success(`Installed skills from ${result.sourcesProcessed} gh source(s) using GitHub CLI.`);
}
