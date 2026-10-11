import { join } from "node:path";

import { CODEWHALE_CONFIG_FILE_NAME, CODEWHALE_DIR } from "../../constants/codewhale-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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

function projectConfigFilePath(outputRoot: string): string {
  return join(
    outputRoot,
    CODEWHALE_PROJECT_CONFIG_PATHS.relativeDirPath,
    CODEWHALE_PROJECT_CONFIG_PATHS.relativeFilePath,
  );
}

function parseProjectConfig({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath: string;
}): Record<string, unknown> {
  return parseSharedConfig({ format: "toml", fileContent, filePath, invalidRootPolicy: "error" });
}

/**
 * Whether an overlay disables shell (`allow_shell = false`). A file that
 * cannot be read as TOML is reported and treated as not disabling shell.
 */
function disablesShell({
  fileContent,
  filePath,
  logger,
}: {
  fileContent: string;
  filePath: string;
  logger?: Logger;
}): boolean {
  try {
    return parseProjectConfig({ fileContent, filePath })[CODEWHALE_ALLOW_SHELL_KEY] === false;
  } catch (error) {
    logger?.warn(
      `Codewhale permissions: not reading "allow_shell" from ${filePath}, so a shell deny set there is not taken into account: ${formatError(error)}`,
    );
    return false;
  }
}

/**
 * Whether the project overlay at `outputRoot` disables shell
 * (`allow_shell = false`), for import.
 */
export async function readCodewhaleProjectShellDisabled({
  outputRoot,
  logger,
}: {
  outputRoot: string;
  logger?: Logger;
}): Promise<boolean> {
  const filePath = projectConfigFilePath(outputRoot);
  const fileContent = await readFileContentOrNull(filePath);
  if (fileContent === null) return false;
  return disablesShell({ fileContent, filePath, logger });
}

/**
 * The project `.codewhale/config.toml` overlay carrying `allow_shell = false`
 * when the canonical config denies every shell command, or `null` when the
 * file needs no change.
 *
 * Only `allow_shell` is written; every other overlay key (`model`,
 * `approval_policy`, ...) is kept, and an existing file that is not valid TOML
 * is an error only when it has to be written. An existing
 * `allow_shell = false` is never removed: the overlay cannot widen access, and
 * a hand-written value cannot be told apart from one rulesync wrote, so it is
 * reported instead.
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
  const filePath = projectConfigFilePath(outputRoot);
  // Read without initializing so a dry run or `--check` stays side-effect-free.
  const existingContent = await readFileContentOrNull(filePath);

  if (!deniesEveryShellCommand(config.permission)) {
    if (
      existingContent !== null &&
      disablesShell({ fileContent: existingContent, filePath, logger })
    ) {
      logger?.warn(
        `Codewhale permissions: keeping "allow_shell = false" in ${filePath}; rulesync does not remove it. Delete it by hand to re-enable shell tools in this project, or add bash: { "*": "deny" } to the rulesync permissions to match it.`,
      );
    }
    return null;
  }
  const existing = parseProjectConfig({ fileContent: existingContent ?? "", filePath });
  if (existing[CODEWHALE_ALLOW_SHELL_KEY] === false) return null;

  return new CodewhaleProjectConfigFile({
    outputRoot,
    ...CODEWHALE_PROJECT_CONFIG_PATHS,
    fileContent: applySharedConfigPatch({
      fileKey: sharedConfigFileKey(CODEWHALE_PROJECT_CONFIG_PATHS),
      feature: "permissions",
      existingContent: existingContent ?? "",
      patch: { [CODEWHALE_ALLOW_SHELL_KEY]: false },
      filePath,
      logger,
    }),
  });
}
