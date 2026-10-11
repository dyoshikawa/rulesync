import { join } from "node:path";

import * as smolToml from "smol-toml";

import { CODEWHALE_CONFIG_FILE_NAME, CODEWHALE_DIR } from "../../constants/codewhale-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { collectShellCommandRules } from "./shell-command-categories.js";

/**
 * The top-level key of the per-project `.codewhale/config.toml` overlay that
 * hides Codewhale's shell tools. The overlay only tightens: `false` disables
 * shell for the session, while `true` is ignored with a warning.
 * @see https://github.com/Hmbown/Codewhale/blob/fead51eeea0fb6038ea3e30923751b1a1c765b25/docs/CONFIGURATION.md#per-project-overlay-485
 * @see https://github.com/Hmbown/Codewhale/blob/fead51eeea0fb6038ea3e30923751b1a1c765b25/crates/tui/src/lib.rs
 */
const CODEWHALE_ALLOW_SHELL_KEY = "allow_shell";

export const CODEWHALE_PROJECT_CONFIG_PATHS = {
  relativeDirPath: CODEWHALE_DIR,
  relativeFilePath: CODEWHALE_CONFIG_FILE_NAME,
} as const;

/** The project `.codewhale/config.toml` overlay, as written by the permissions feature. */
export class CodewhaleProjectConfigFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

/**
 * Whether the canonical config denies every shell command: a `deny` on the
 * catch-all `*` (or `**`) pattern of `bash` or of the all-tools `*` category.
 * Codewhale decides by action before specificity, so such a deny already
 * blocks every command in global scope too, whatever `allow` rules sit beside
 * it.
 */
export function deniesEveryShellCommand(permission: PermissionsConfig["permission"]): boolean {
  return collectShellCommandRules(permission).rules.some(
    ({ pattern, action }) => action === "deny" && isShellCatchAll(pattern),
  );
}

/** Whether a canonical shell pattern names every command. */
export function isShellCatchAll(pattern: string): boolean {
  const trimmed = pattern.trim();
  return trimmed === "*" || trimmed === "**";
}

function parseProjectConfig({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath: string;
}): Record<string, unknown> {
  if (fileContent.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = smolToml.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${formatError(error)}`, { cause: error });
  }
  return isPlainObject(parsed) ? parsed : {};
}

/**
 * Whether the project overlay at `outputRoot` disables shell
 * (`allow_shell = false`), for import. A file that cannot be read as TOML is
 * reported and treated as not disabling shell.
 */
export async function readCodewhaleProjectShellDisabled({
  outputRoot,
  logger,
}: {
  outputRoot: string;
  logger?: Logger;
}): Promise<boolean> {
  const filePath = join(
    outputRoot,
    CODEWHALE_PROJECT_CONFIG_PATHS.relativeDirPath,
    CODEWHALE_PROJECT_CONFIG_PATHS.relativeFilePath,
  );
  const fileContent = await readFileContentOrNull(filePath);
  if (fileContent === null) return false;
  try {
    return parseProjectConfig({ fileContent, filePath })[CODEWHALE_ALLOW_SHELL_KEY] === false;
  } catch (error) {
    logger?.warn(
      `Codewhale permissions: not reading "allow_shell" from ${filePath}: ${formatError(error)}`,
    );
    return false;
  }
}

/**
 * The project `.codewhale/config.toml` overlay carrying `allow_shell = false`
 * when the canonical config denies every shell command, or `null` when the
 * file needs no change.
 *
 * Only `allow_shell` is written; every other overlay key (`model`,
 * `approval_policy`, ...) is kept. An existing `allow_shell = false` is never
 * removed: the overlay cannot widen access, and a hand-written value cannot be
 * told apart from one rulesync wrote, so it is reported instead.
 */
export async function createCodewhaleProjectConfigFile({
  outputRoot = process.cwd(),
  config,
  logger,
}: {
  outputRoot?: string;
  config: PermissionsConfig;
  logger?: Logger;
}): Promise<CodewhaleProjectConfigFile | null> {
  const { relativeDirPath, relativeFilePath } = CODEWHALE_PROJECT_CONFIG_PATHS;
  const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
  // Read without initializing so a dry run or `--check` stays side-effect-free.
  const existingContent = (await readFileContentOrNull(filePath)) ?? "";
  const existing = parseProjectConfig({ fileContent: existingContent, filePath });
  const alreadyDisabled = existing[CODEWHALE_ALLOW_SHELL_KEY] === false;

  if (!deniesEveryShellCommand(config.permission)) {
    if (alreadyDisabled) {
      logger?.warn(
        `Codewhale permissions: keeping "allow_shell = false" in ${filePath}; rulesync does not remove it, so delete it by hand to re-enable shell tools in this project.`,
      );
    }
    return null;
  }
  if (alreadyDisabled) return null;

  return new CodewhaleProjectConfigFile({
    outputRoot,
    relativeDirPath,
    relativeFilePath,
    fileContent: applySharedConfigPatch({
      fileKey: sharedConfigFileKey(CODEWHALE_PROJECT_CONFIG_PATHS),
      feature: "permissions",
      existingContent,
      patch: { [CODEWHALE_ALLOW_SHELL_KEY]: false },
      filePath,
      logger,
    }),
  });
}
