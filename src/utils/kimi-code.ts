import { join, resolve } from "node:path";

import { KIMI_CODE_DIR } from "../constants/kimi-code-paths.js";
import { getHomeDirectory } from "./file.js";

export function getKimiCodeHome(): string | undefined {
  const configuredHome = process.env.KIMI_CODE_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : undefined;
}

export function getKimiCodeRelativeDirPath({
  global,
  relativeDirPath = ".",
}: {
  global: boolean;
  relativeDirPath?: string;
}): string {
  return global && getKimiCodeHome() ? relativeDirPath : join(KIMI_CODE_DIR, relativeDirPath);
}

export function getKimiCodeRulesyncOutputRoot({
  nativeOutputRoot,
  global,
}: {
  nativeOutputRoot: string;
  global: boolean;
}): string {
  return global && getKimiCodeHome() ? getHomeDirectory() : nativeOutputRoot;
}
