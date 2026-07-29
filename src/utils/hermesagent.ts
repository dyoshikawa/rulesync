import { basename, dirname, join, relative, resolve } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_GLOBAL_WIN32_DIR,
} from "../constants/hermesagent-paths.js";
import { sharedConfigFileKey } from "../features/shared/shared-config-gateway.js";
import type { SharedWritePath } from "../lib/shared-file-derive.js";
import { checkPathTraversal } from "./file.js";
import { getToolRulesyncOutputRoot } from "./tool-home.js";

export function getHermesagentHome(): string | undefined {
  const configuredHome = process.env.HERMES_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : undefined;
}

/**
 * The home-relative Hermes profile directory used when `HERMES_HOME` is unset.
 *
 * Upstream `_get_platform_default_hermes_home()` returns `%LOCALAPPDATA%\hermes`
 * on win32 and `~/.hermes` everywhere else, so the global output directory is
 * platform-dependent — a global generate on Windows that wrote `~/.hermes`
 * would land where Hermes never reads.
 *
 * @see https://github.com/NousResearch/hermes-agent `hermes_constants.py`
 */
export function getHermesagentGlobalDir(): string {
  return process.platform === "win32" ? HERMESAGENT_GLOBAL_WIN32_DIR : HERMESAGENT_GLOBAL_DIR;
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

/**
 * Map a canonical `.hermes/...` path constant onto the directory rulesync
 * actually writes in the requested scope.
 *
 * Project scope keeps the constant as-is (the project tree is `.hermes/`
 * everywhere). Global scope strips the `.hermes` prefix and re-anchors it:
 * `HERMES_HOME` *is* the profile root, so nothing is prepended; otherwise the
 * platform default directory takes its place.
 */
export function getHermesagentRelativeDirPath({
  global,
  relativeDirPath,
}: {
  global: boolean;
  relativeDirPath: string;
}): string {
  if (!global) return relativeDirPath;

  const relativePath = relative(HERMESAGENT_GLOBAL_DIR, relativeDirPath);
  try {
    // The input is checked as well as the de-prefixed result: `relative()`
    // normalizes `..` away, so a path that walks out of `.hermes` and back in
    // would otherwise pass a containment check on the result alone.
    checkPathTraversal({ relativePath: relativeDirPath, intendedRootDir: "." });
    checkPathTraversal({ relativePath, intendedRootDir: HERMESAGENT_GLOBAL_DIR });
  } catch {
    throw new Error(
      `Hermes Agent global path must be within ${HERMESAGENT_GLOBAL_DIR}: ${relativeDirPath}`,
    );
  }
  // `.` rather than `""` for the profile root itself: both join identically, but
  // only one of them compares equal to the declared shared-write path.
  return getHermesagentHome() ? relativePath || "." : join(getHermesagentGlobalDir(), relativePath);
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

/**
 * Every spelling `config.yaml` can take in global scope, so that the
 * shared-write derivation and the gateway ownership table it is checked against
 * see the same set of keys on every platform and with or without `HERMES_HOME`.
 *
 * `getHermesagentRelativeDirPath` resolves exactly one of these per process,
 * which would otherwise make the derived shared-file key depend on the ambient
 * environment — the drift guards would then go blind in precisely the
 * configuration this feature exists for.
 */
export function getHermesagentSharedConfigWritePaths(): SharedWritePath[] {
  return [
    // `~/.hermes` (every platform but win32) and `%LOCALAPPDATA%\hermes` (win32).
    { relativeDirPath: HERMESAGENT_GLOBAL_DIR, relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME },
    {
      relativeDirPath: HERMESAGENT_GLOBAL_WIN32_DIR,
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    },
    // The `HERMES_HOME` case: the profile root is the output root itself, so the
    // config sits at the root with no directory component.
    { relativeDirPath: ".", relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME },
  ];
}

/**
 * The `SHARED_CONFIG_OWNERSHIP` key of the `config.yaml` this scope actually
 * writes. All three spellings carry the same declaration, but passing the key of
 * the file being written keeps the write path and the drift guards reading the
 * same entry.
 */
export function getHermesagentConfigSharedFileKey({ global }: { global: boolean }): string {
  return sharedConfigFileKey({
    relativeDirPath: getHermesagentRelativeDirPath({
      global,
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
    }),
    relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
  });
}

export function getHermesagentRulesyncOutputRoot({
  nativeOutputRoot,
  global,
}: {
  nativeOutputRoot: string;
  global: boolean;
}): string {
  return getToolRulesyncOutputRoot({ nativeOutputRoot, global, toolHome: getHermesagentHome });
}
