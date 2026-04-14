import { join } from "node:path";

import { ConfigResolver } from "../../config/config-resolver.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { fileExists } from "../../utils/file.js";

export type ResolveGitignoreTargetsParams = {
  readonly cliTargets: readonly string[] | undefined;
  readonly cwd?: string;
};

/**
 * Resolve the list of targets to pass to `gitignoreCommand`.
 *
 * Precedence:
 *   1. Explicit `--targets` CLI option wins.
 *   2. If neither rulesync.jsonc nor rulesync.local.jsonc exists, return
 *      `undefined` so all supported tools' entries are emitted. Otherwise a
 *      user without a config file would silently get only the default
 *      `["agentsmd"]` target, which is a surprising behavior change.
 *   3. If `gitignoreTargetsOnly` is true (the default), return the config's
 *      `targets`.
 *   4. Otherwise return `undefined` to emit entries for every supported tool.
 */
export const resolveGitignoreTargets = async ({
  cliTargets,
  cwd = process.cwd(),
}: ResolveGitignoreTargetsParams): Promise<readonly string[] | undefined> => {
  if (cliTargets !== undefined) {
    return cliTargets;
  }

  const baseConfigPath = join(cwd, RULESYNC_CONFIG_RELATIVE_FILE_PATH);
  const localConfigPath = join(cwd, RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH);
  const [hasBase, hasLocal] = await Promise.all([
    fileExists(baseConfigPath),
    fileExists(localConfigPath),
  ]);

  if (!hasBase && !hasLocal) {
    return undefined;
  }

  const config = await ConfigResolver.resolve({});
  if (config.getGitignoreTargetsOnly()) {
    return config.getTargets();
  }
  return undefined;
};
