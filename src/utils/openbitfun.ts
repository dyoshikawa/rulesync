import { isAbsolute, join, resolve } from "node:path";

import { getHomeDirectory } from "./file.js";
import { type Logger, warnOnceWithFallback } from "./logger.js";

const XDG_OVERRIDES = {
  config: { envVar: "XDG_CONFIG_HOME", defaultDir: ".config" },
  data: { envVar: "XDG_DATA_HOME", defaultDir: join(".local", "share") },
} as const;

/**
 * Warn, once per run, when an XDG base directory variable moves OpenBitFun's
 * user tree away from where rulesync writes it in global mode.
 *
 * On Linux OpenBitFun resolves its user root through the `dirs` crate
 * (`dirs::config_dir()`, and `dirs::data_local_dir()` for skills), which
 * follows `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` when set to an absolute path.
 * rulesync writes (and `import --global` reads) global files relative to the
 * home directory, at the XDG default location, so a non-default value means
 * OpenBitFun reads elsewhere.
 * macOS and Windows do not use these variables.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/assembly/core/src/infrastructure/app_paths/path_manager.rs
 */
export function warnOpenbitfunXdgOverride({
  kind,
  logger,
}: {
  kind: keyof typeof XDG_OVERRIDES;
  logger?: Logger;
}): void {
  if (process.platform === "darwin" || process.platform === "win32") {
    return;
  }
  const { envVar, defaultDir } = XDG_OVERRIDES[kind];
  const value = process.env[envVar]?.trim();
  // `dirs` ignores an empty or relative value and falls back to the default.
  if (!value || !isAbsolute(value)) {
    return;
  }
  const defaultPath = join(getHomeDirectory(), defaultDir);
  if (resolve(value) === resolve(defaultPath)) {
    return;
  }
  warnOnceWithFallback(
    logger,
    `$${envVar} is set to ${value}, so OpenBitFun reads its user files from ` +
      `${join(value, "openbitfun")}, but rulesync reads and writes OpenBitFun's global files under ` +
      `${join("~", defaultDir, "openbitfun")}. Move them there or unset $${envVar} for OpenBitFun.`,
  );
}
