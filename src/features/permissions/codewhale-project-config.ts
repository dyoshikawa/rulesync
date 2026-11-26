import { join } from "node:path";

import { CODEWHALE_CONFIG_FILE_NAME, CODEWHALE_DIR } from "../../constants/codewhale-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
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

/**
 * The `[auto_review]` table of the user `~/.codewhale/config.toml`: the
 * tool-call review policy (`reviewer_model`, `environment`,
 * `review_all_shell`, `[[auto_review.allow]]` / `[[auto_review.block]]`
 * rules, ...). Codewhale reads it from the user and managed config only; a
 * project-scope `[auto_review]` table is ignored with a warning.
 * @see https://github.com/codewhale-hq/Codewhale/blob/main/docs/CONFIGURATION.md
 */
const CODEWHALE_AUTO_REVIEW_KEY = "auto_review";

export const CODEWHALE_PROJECT_CONFIG_PATHS = {
  relativeDirPath: CODEWHALE_DIR,
  relativeFilePath: CODEWHALE_CONFIG_FILE_NAME,
} as const;

/**
 * A Codewhale `config.toml` as written by the permissions feature: the project
 * overlay (`allow_shell`) or the user config (`[auto_review]`).
 */
class CodewhaleConfigFile extends ToolFile {
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

function codewhaleConfigFilePath(outputRoot: string): string {
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
  const filePath = codewhaleConfigFilePath(outputRoot);
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
}): Promise<CodewhaleConfigFile | null> {
  const filePath = codewhaleConfigFilePath(outputRoot);
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

  return new CodewhaleConfigFile({
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

/**
 * The `codewhale.auto_review` override of the canonical config, or `undefined`
 * when it is not set.
 */
function authoredAutoReview(config: PermissionsConfig): Record<string, unknown> | undefined {
  const autoReview = config.codewhale?.auto_review;
  return isRecord(autoReview) ? autoReview : undefined;
}

/**
 * Warn that a `codewhale.auto_review` override is not written in project scope:
 * Codewhale ignores a project `[auto_review]` table, so a checked-in
 * repository cannot relax the review of its own tool calls.
 */
export function warnAboutProjectAutoReview({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): void {
  if (authoredAutoReview(config) === undefined) return;
  logger?.warn(
    `Codewhale permissions: skipping codewhale.auto_review in project mode because Codewhale reads [auto_review] only from the user ~/.codewhale/config.toml (a project-scope table is ignored). Run generate with --global to write it.`,
  );
}

/**
 * The user `~/.codewhale/config.toml` with its `[auto_review]` table replaced
 * by the `codewhale.auto_review` override, or `null` when the override is not
 * set. Every other table (`[hooks]`, `model`, `projects`, ...) is kept, and a
 * file that is not valid TOML is an error. Removing the override leaves the
 * table in place.
 */
export async function createCodewhaleUserConfigFile({
  outputRoot = process.cwd(),
  config,
  logger,
}: {
  outputRoot?: string;
  config: PermissionsConfig;
  logger?: Logger;
}): Promise<CodewhaleConfigFile | null> {
  const autoReview = authoredAutoReview(config);
  if (autoReview === undefined) return null;
  const filePath = codewhaleConfigFilePath(outputRoot);
  // Read without initializing so a dry run or `--check` stays side-effect-free.
  const existingContent = (await readFileContentOrNull(filePath)) ?? "";
  return new CodewhaleConfigFile({
    outputRoot,
    ...CODEWHALE_PROJECT_CONFIG_PATHS,
    fileContent: applySharedConfigPatch({
      fileKey: sharedConfigFileKey(CODEWHALE_PROJECT_CONFIG_PATHS),
      feature: "permissions",
      existingContent,
      patch: { [CODEWHALE_AUTO_REVIEW_KEY]: autoReview },
      filePath,
      logger,
    }),
  });
}

/**
 * The `[auto_review]` table of the user `~/.codewhale/config.toml` under
 * `outputRoot`, for import, or `undefined` when there is none. A file that
 * cannot be read as TOML is reported and treated as having no table.
 */
export async function readCodewhaleUserAutoReview({
  outputRoot,
  logger,
}: {
  outputRoot: string;
  logger?: Logger;
}): Promise<Record<string, unknown> | undefined> {
  const filePath = codewhaleConfigFilePath(outputRoot);
  const fileContent = await readFileContentOrNull(filePath);
  if (fileContent === null) return undefined;
  try {
    const autoReview = parseProjectConfig({ fileContent, filePath })[CODEWHALE_AUTO_REVIEW_KEY];
    return isRecord(autoReview) ? autoReview : undefined;
  } catch (error) {
    logger?.warn(
      `Codewhale permissions: not reading [auto_review] from ${filePath}: ${formatError(error)}`,
    );
    return undefined;
  }
}
