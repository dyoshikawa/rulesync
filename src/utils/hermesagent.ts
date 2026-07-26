import { basename, dirname, join, relative, resolve } from "node:path";

import { HERMESAGENT_GLOBAL_DIR } from "../constants/hermesagent-paths.js";
import { getHomeDirectory } from "./file.js";

export function getHermesagentHome(): string | undefined {
  const configuredHome = process.env.HERMES_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : undefined;
}

export function resolveHermesagentOutputRoot({
  outputRoot,
  global,
}: {
  outputRoot: string;
  global: boolean;
}): string {
  return global ? (getHermesagentHome() ?? outputRoot) : outputRoot;
}

export function getHermesagentRelativeDirPath({
  global,
  relativeDirPath,
}: {
  global: boolean;
  relativeDirPath: string;
}): string {
  return global && getHermesagentHome()
    ? relative(HERMESAGENT_GLOBAL_DIR, relativeDirPath)
    : relativeDirPath;
}

export function getHermesagentRelativeFilePath({
  global,
  relativeFilePath,
}: {
  global: boolean;
  relativeFilePath: string;
}): string {
  return join(
    getHermesagentRelativeDirPath({
      global,
      relativeDirPath: dirname(relativeFilePath),
    }),
    basename(relativeFilePath),
  );
}

export function getHermesagentRulesyncOutputRoot({
  nativeOutputRoot,
  global,
}: {
  nativeOutputRoot: string;
  global: boolean;
}): string {
  return global && getHermesagentHome() ? getHomeDirectory() : nativeOutputRoot;
}
