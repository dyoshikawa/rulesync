import { basename, join, relative } from "node:path";

import { Semaphore } from "es-toolkit/promise";
import { parse as parseJsonc } from "jsonc-parser";

import type { Config, SourceEntry } from "../../config/config.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_PLUGINS_RELATIVE_DIR_PATH,
  RULESYNC_PLUGIN_MANIFEST_FILE_NAME,
  RULESYNC_PLUGINS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  fileExists,
  findFilesByGlobs,
  getHomeDirectory,
  readFileContent,
  removeDirectory,
  removeFile,
  toPosixPath,
  writeFileContent,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "../github-client.js";
import { listDirectoryRecursive } from "../github-utils.js";
import { parseSource } from "../source-parser.js";
import {
  computePluginContentHash,
  createEmptyPluginLock,
  findPluginInstallation,
  readPluginLock,
  writePluginLock,
} from "./plugin-lock.js";
import { PluginManifestSchema, type PluginManifest } from "./plugin-manifest.js";

const LOCAL_PLUGIN_RESOLVED_COMMIT = "0".repeat(40);

type InstallPluginsOptions = {
  update?: boolean;
  frozen?: boolean;
  token?: string;
};

export type InstallPluginsResult = {
  installedPluginCount: number;
  installedFileCount: number;
  sourcesProcessed: number;
  localPluginsProcessed: number;
};

type PluginPackage = {
  manifest: PluginManifest;
  pluginDir: string;
  source?: string;
  requestedRef?: string;
  resolvedCommit: string;
};

export async function installPlugins(params: {
  config: Config;
  projectRoot: string;
  options?: InstallPluginsOptions;
  logger: Logger;
}): Promise<InstallPluginsResult> {
  const { config, projectRoot, options = {}, logger } = params;

  const enabledTargets = config
    .getTargets()
    .filter((target) => config.getFeatures(target).includes("plugins"));
  if (enabledTargets.length === 0) {
    return {
      installedPluginCount: 0,
      installedFileCount: 0,
      sourcesProcessed: 0,
      localPluginsProcessed: 0,
    };
  }

  for (const target of enabledTargets) {
    if (target !== "codexcli" && target !== "claudecode") {
      logger.warn(`Target '${target}' does not support the feature 'plugins'. Skipping.`);
    }
  }
  const supportedTargets = enabledTargets.filter(
    (target) => target === "codexcli" || target === "claudecode",
  );
  if (supportedTargets.length === 0) {
    return {
      installedPluginCount: 0,
      installedFileCount: 0,
      sourcesProcessed: 0,
      localPluginsProcessed: 0,
    };
  }

  const localPlugins = await loadLocalPlugins({ inputRoot: config.getInputRoot() });
  const curatedPlugins = await fetchCuratedPlugins({
    sources: config.getSources(),
    projectRoot,
    enabledTargets: supportedTargets,
    options,
    localPluginNames: new Set(localPlugins.map((plugin) => plugin.manifest.name)),
    logger,
  });

  const pluginsByName = new Map<string, PluginPackage>();
  for (const plugin of curatedPlugins.plugins) {
    pluginsByName.set(plugin.manifest.name, plugin);
  }
  for (const plugin of localPlugins) {
    pluginsByName.set(plugin.manifest.name, plugin);
  }

  if (pluginsByName.size === 0) {
    return {
      installedPluginCount: 0,
      installedFileCount: 0,
      sourcesProcessed: curatedPlugins.sourcesProcessed,
      localPluginsProcessed: localPlugins.length,
    };
  }

  const existingLock = await readPluginLock(projectRoot);
  const frozen = options.frozen ?? false;
  if (frozen && !existingLock) {
    throw new Error(
      "Frozen install failed: rulesync-plugins.lock.yaml is missing. Run 'rulesync install' to create it.",
    );
  }
  const nextLock = createEmptyPluginLock({ existingLock });

  let installedPluginCount = 0;
  let installedFileCount = 0;

  for (const target of supportedTargets) {
    for (const plugin of pluginsByName.values()) {
      if (!plugin.manifest.targets.includes(target)) {
        continue;
      }
      const result = await installPluginForTarget({
        plugin,
        target,
        existingLock,
        nextLock,
        frozen,
      });
      if (result.changed) {
        installedPluginCount += 1;
        installedFileCount += result.deployedFileCount;
      }
    }
  }

  if (!frozen) {
    await writePluginLock({ projectRoot, lock: nextLock });
  }

  return {
    installedPluginCount,
    installedFileCount,
    sourcesProcessed: curatedPlugins.sourcesProcessed,
    localPluginsProcessed: localPlugins.length,
  };
}

async function loadLocalPlugins(params: { inputRoot: string }): Promise<PluginPackage[]> {
  const pluginsDir = join(params.inputRoot, RULESYNC_PLUGINS_RELATIVE_DIR_PATH);
  if (!(await directoryExists(pluginsDir))) {
    return [];
  }

  const pluginDirs = await findFilesByGlobs(join(pluginsDir, "*"), { type: "dir" });
  const plugins: PluginPackage[] = [];

  for (const pluginDir of pluginDirs) {
    if (basename(pluginDir) === ".curated") {
      continue;
    }
    const manifestPath = join(pluginDir, RULESYNC_PLUGIN_MANIFEST_FILE_NAME);
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    const manifest = PluginManifestSchema.parse(parseJsonc(await readFileContent(manifestPath)));
    plugins.push({
      manifest,
      pluginDir,
      resolvedCommit: LOCAL_PLUGIN_RESOLVED_COMMIT,
    });
  }

  return plugins;
}

async function fetchCuratedPlugins(params: {
  sources: SourceEntry[];
  projectRoot: string;
  enabledTargets: ToolTarget[];
  options: InstallPluginsOptions;
  localPluginNames: Set<string>;
  logger: Logger;
}): Promise<{ plugins: PluginPackage[]; sourcesProcessed: number }> {
  const { sources, projectRoot, enabledTargets, options, localPluginNames, logger } = params;
  const pluginSources = sources.filter((source) => (source.plugins?.length ?? 0) > 0);
  if (pluginSources.length === 0) {
    return { plugins: [], sourcesProcessed: 0 };
  }

  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const plugins: PluginPackage[] = [];
  const seenPluginNames = new Set<string>();

  for (const source of pluginSources) {
    if (source.transport === "git") {
      logger.warn(
        `Plugin fetching via transport "git" is not supported in V1. Skipping "${source.source}".`,
      );
      continue;
    }

    const parsed = parseSource(source.source);
    if (parsed.provider !== "github") {
      logger.warn(
        `Plugin fetching only supports GitHub sources in V1. Skipping "${source.source}".`,
      );
      continue;
    }

    try {
      const requestedRef =
        source.ref ?? parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
      const resolvedCommit = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);

      for (const declaredPlugin of source.plugins ?? []) {
        if (localPluginNames.has(declaredPlugin.name) || seenPluginNames.has(declaredPlugin.name)) {
          continue;
        }
        if (!declaredPlugin.targets.some((target) => enabledTargets.includes(target))) {
          continue;
        }

        const targetConfigs: Array<{ target: string; artifactPath: string }> = [];
        if (enabledTargets.includes("codexcli") && declaredPlugin.codexcli) {
          targetConfigs.push({
            target: "codexcli",
            artifactPath: declaredPlugin.codexcli.artifact.path,
          });
        }
        if (enabledTargets.includes("claudecode") && declaredPlugin.claudecode) {
          targetConfigs.push({
            target: "claudecode",
            artifactPath: declaredPlugin.claudecode.artifact.path,
          });
        }
        if (targetConfigs.length === 0) {
          continue;
        }

        const pluginDir = join(
          projectRoot,
          RULESYNC_CURATED_PLUGINS_RELATIVE_DIR_PATH,
          declaredPlugin.name,
        );
        await removeDirectory(pluginDir);

        const seenArtifactPaths = new Set<string>();
        for (const { artifactPath } of targetConfigs) {
          if (seenArtifactPaths.has(artifactPath)) {
            continue;
          }
          seenArtifactPaths.add(artifactPath);

          const files = await listDirectoryRecursive({
            client,
            owner: parsed.owner,
            repo: parsed.repo,
            path: artifactPath,
            ref: resolvedCommit,
            semaphore,
          });

          for (const file of files) {
            if (file.type !== "file") {
              continue;
            }
            if (file.size > MAX_FILE_SIZE) {
              logger.warn(
                `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
              );
              continue;
            }
            const relativePath = file.path.substring(artifactPath.length + 1);
            const content = await client.getFileContent(
              parsed.owner,
              parsed.repo,
              file.path,
              resolvedCommit,
            );
            checkPathTraversal({
              relativePath: join(artifactPath, relativePath),
              intendedRootDir: pluginDir,
            });
            await writeFileContent(join(pluginDir, artifactPath, relativePath), content);
          }
        }

        await writeFileContent(
          join(pluginDir, RULESYNC_PLUGIN_MANIFEST_FILE_NAME),
          JSON.stringify(declaredPlugin, null, 2) + "\n",
        );

        plugins.push({
          manifest: declaredPlugin,
          pluginDir,
          source: source.source,
          requestedRef,
          resolvedCommit,
        });
        seenPluginNames.add(declaredPlugin.name);
      }
    } catch (error) {
      logger.error(`Failed to fetch plugins from "${source.source}": ${formatError(error)}`);
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints({ error, logger });
      }
    }
  }

  return { plugins, sourcesProcessed: pluginSources.length };
}

async function installPluginForTarget(params: {
  plugin: PluginPackage;
  target: "codexcli" | "claudecode";
  existingLock: Awaited<ReturnType<typeof readPluginLock>>;
  nextLock: ReturnType<typeof createEmptyPluginLock>;
  frozen: boolean;
}): Promise<{ changed: boolean; deployedFileCount: number }> {
  const { plugin, target, existingLock, nextLock, frozen } = params;
  const targetConfig =
    target === "codexcli" ? plugin.manifest.codexcli : plugin.manifest.claudecode;
  if (!targetConfig) {
    return { changed: false, deployedFileCount: 0 };
  }

  const artifactDir = join(plugin.pluginDir, targetConfig.artifact.path);
  if (!(await directoryExists(artifactDir))) {
    throw new Error(
      `Plugin "${plugin.manifest.name}" is missing artifact directory "${targetConfig.artifact.path}".`,
    );
  }

  const sourceFiles = await findFilesByGlobs(join(artifactDir, "**", "*"), { type: "file" });
  const filePayloads: Array<{ relativePath: string; content: string }> = [];
  for (const sourceFile of sourceFiles) {
    const relativePath = toPosixPath(relative(artifactDir, sourceFile));
    filePayloads.push({
      relativePath,
      content: await readFileContent(sourceFile),
    });
  }

  const installDir =
    target === "codexcli"
      ? join(getHomeDirectory(), ".codex", "skills")
      : join(getHomeDirectory(), ".claude", "skills");
  const lockEntry = existingLock
    ? findPluginInstallation(existingLock, {
        plugin: plugin.manifest.name,
        target,
        scope: "user",
      })
    : undefined;
  const contentHash = computePluginContentHash(
    filePayloads.map((file) => ({ path: file.relativePath, content: file.content })),
  );

  if (frozen) {
    if (!lockEntry) {
      throw new Error(
        `Frozen install failed: rulesync-plugins.lock.yaml is missing entry for plugin "${plugin.manifest.name}" target "${target}".`,
      );
    }
    if (lockEntry.resolved_commit !== plugin.resolvedCommit) {
      throw new Error(
        `Frozen install failed: resolved commit mismatch for plugin "${plugin.manifest.name}" (manifest=${plugin.resolvedCommit}, lock=${lockEntry.resolved_commit}).`,
      );
    }
    if (lockEntry.content_hash !== contentHash) {
      throw new Error(
        `Frozen install failed: content_hash mismatch for plugin "${plugin.manifest.name}".`,
      );
    }
    for (const file of lockEntry.deployed_files) {
      const absolutePath = join(lockEntry.install_dir, file);
      if (!(await fileExists(absolutePath))) {
        throw new Error(
          `Frozen install failed: deployed file is missing for plugin "${plugin.manifest.name}": ${absolutePath}`,
        );
      }
    }
    nextLock.installations.push(lockEntry);
    return { changed: false, deployedFileCount: 0 };
  }

  const filesExist =
    lockEntry !== undefined &&
    (
      await Promise.all(
        lockEntry.deployed_files.map((file) => fileExists(join(lockEntry.install_dir, file))),
      )
    ).every(Boolean);
  if (
    lockEntry &&
    lockEntry.resolved_commit === plugin.resolvedCommit &&
    lockEntry.content_hash === contentHash &&
    filesExist
  ) {
    nextLock.installations.push(lockEntry);
    return { changed: false, deployedFileCount: 0 };
  }

  if (lockEntry) {
    for (const oldFile of lockEntry.deployed_files) {
      await removeFile(join(lockEntry.install_dir, oldFile));
    }
  }

  for (const file of filePayloads) {
    checkPathTraversal({ relativePath: file.relativePath, intendedRootDir: installDir });
    await writeFileContent(join(installDir, file.relativePath), file.content);
  }

  nextLock.installations.push({
    source: plugin.source,
    plugin: plugin.manifest.name,
    requested_ref: plugin.requestedRef,
    resolved_commit: plugin.resolvedCommit,
    target,
    scope: "user",
    install_strategy: targetConfig.install.strategy,
    install_dir: installDir,
    deployed_files: filePayloads.map((file) => file.relativePath),
    content_hash: contentHash,
    installed_at: new Date().toISOString(),
  });

  return { changed: true, deployedFileCount: filePayloads.length };
}
