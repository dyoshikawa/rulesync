import { join, resolve } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME, KIMI_CODE_DIR } from "../constants/kimi-code-paths.js";
import { sharedConfigFileKey } from "../features/shared/shared-config-gateway.js";
import type { SharedWritePath } from "../lib/shared-file-derive.js";
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

/**
 * Both spellings the shared user `config.toml` can take: under `.kimi-code/`,
 * or at the root of `KIMI_CODE_HOME` when that override names the profile dir.
 * Declared unconditionally so the derived shared-file keys — and the drift
 * guards checked against them — do not depend on the ambient environment.
 */
export function getKimiCodeSharedConfigWritePaths(): SharedWritePath[] {
  return [
    { relativeDirPath: KIMI_CODE_DIR, relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME },
    { relativeDirPath: ".", relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME },
  ];
}

/**
 * The `SHARED_CONFIG_OWNERSHIP` key of the `config.toml` actually being written.
 * Both spellings carry the same declaration, but passing the key of the file
 * being written keeps the write path and the drift guards on the same entry.
 */
export function getKimiCodeConfigSharedFileKey({ global }: { global: boolean }): string {
  return sharedConfigFileKey({
    relativeDirPath: getKimiCodeRelativeDirPath({ global }),
    relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
  });
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
