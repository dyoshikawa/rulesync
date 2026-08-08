import { join, resolve } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME } from "../../constants/kimi-code-paths.js";
import {
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_KIMI_CODE_EVENT_NAMES,
  KIMI_CODE_HOOK_EVENTS,
  KIMI_CODE_NATIVE_HOOK_EVENTS,
  KIMI_CODE_TO_CANONICAL_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
} from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import {
  getKimiCodeConfigSharedFileKey,
  getKimiCodeRelativeDirPath,
  getKimiCodeSharedConfigWritePaths,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
} from "./tool-hooks.js";

type KimiCodeHooksParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

type KimiCodeHookEntry = {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
};

function runFromTrustedDirectory({
  command,
  trustedDirectory,
}: {
  command: string;
  trustedDirectory: string;
}): string {
  if (process.platform === "win32") {
    const escapedDirectory = trustedDirectory.replaceAll("%", "%%").replaceAll('"', '""');
    return `set "RULESYNC_KIMI_HOOK_CWD=1" && cd /d "${escapedDirectory}" && ${command}`;
  }
  const escapedDirectory = trustedDirectory.replaceAll("'", `'"'"'`);
  return `export RULESYNC_KIMI_HOOK_CWD=1 && cd -- '${escapedDirectory}' && ${command}`;
}

function stripTrustedDirectoryWrapper(command: string): string {
  const posix = command.match(
    /^export RULESYNC_KIMI_HOOK_CWD=1 && cd -- '(?:[^']|'"'"')*' && ([\s\S]*)$/,
  );
  if (posix?.[1]) {
    return posix[1];
  }
  const windows = command.match(
    /^set "RULESYNC_KIMI_HOOK_CWD=1" && cd \/d "(?:""|[^"])*" && ([\s\S]*)$/,
  );
  return windows?.[1] ?? command;
}

/**
 * Native Kimi Code events whose Event Reference row lists the matcher as
 * "Empty string" — the matcher has nothing to match against, so Kimi Code
 * ignores it and rulesync drops it rather than emitting a dead field.
 *
 * Keyed on native names because the check runs after the canonical → native
 * mapping: `SessionHeartbeat` and `Interrupt` have no canonical counterpart and
 * are only reachable through a per-tool `kimi-code` override naming them
 * directly.
 *
 * Deliberately narrower than Claude Code's equivalent set: Kimi Code's
 * `UserPromptSubmit` matches the submitted prompt text, and `PermissionResult`
 * matches the tool name, so a matcher on either is meaningful and is kept.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/hooks.html
 */
const KIMI_CODE_NO_MATCHER_EVENTS = new Set(["Stop", "SessionHeartbeat", "Interrupt"]);

/** Resolve the `matcher` part of an emitted entry, dropping dead matchers. */
function resolveMatcherPart({
  matcher,
  nativeEvent,
  logger,
}: {
  matcher: string | undefined;
  nativeEvent: string;
  logger?: Logger;
}): { matcher?: string } {
  if (!matcher) {
    return {};
  }
  if (!KIMI_CODE_NO_MATCHER_EVENTS.has(nativeEvent)) {
    return { matcher };
  }
  logger?.warn(
    `matcher "${matcher}" on "${nativeEvent}" hook will be ignored — this event does not support matchers`,
  );
  return {};
}

function buildEffectiveHooks(
  config: HooksConfig,
  toolOverrideHooks: HooksConfig["hooks"] | undefined,
): HooksConfig["hooks"] {
  const supported = new Set<string>(KIMI_CODE_HOOK_EVENTS);
  const shared: HooksConfig["hooks"] = {};
  for (const [event, definitions] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      shared[event] = definitions;
    }
  }
  return { ...shared, ...toolOverrideHooks };
}

function canonicalToKimiCodeHooks({
  config,
  toolOverrideHooks,
  trustedDirectory,
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  trustedDirectory: string;
  logger?: Logger;
}): KimiCodeHookEntry[] {
  const result: KimiCodeHookEntry[] = [];
  const nativeEvents = new Set<string>(KIMI_CODE_NATIVE_HOOK_EVENTS);
  for (const [event, definitions] of Object.entries(
    buildEffectiveHooks(config, toolOverrideHooks),
  )) {
    const nativeEvent = CANONICAL_TO_KIMI_CODE_EVENT_NAMES[event] ?? event;
    if (!nativeEvents.has(nativeEvent)) {
      logger?.warn(`Kimi Code hooks: skipping unsupported event "${event}".`);
      continue;
    }
    for (const definition of definitions) {
      if ((definition.type ?? "command") !== "command" || !definition.command) {
        continue;
      }
      const timeout = definition.timeout;
      const validTimeout =
        timeout === undefined || (Number.isInteger(timeout) && timeout >= 1 && timeout <= 600);
      if (!validTimeout) {
        logger?.warn(
          `Kimi Code hooks: omitting invalid timeout for "${event}"; expected an integer from 1 to 600 seconds.`,
        );
      }
      result.push({
        event: nativeEvent,
        command: runFromTrustedDirectory({
          command: definition.command,
          trustedDirectory,
        }),
        ...resolveMatcherPart({ matcher: definition.matcher, nativeEvent, logger }),
        ...(validTimeout && timeout !== undefined && { timeout }),
      });
    }
  }
  return result;
}

function kimiCodeHooksToCanonical(hooks: unknown): HooksConfig["hooks"] {
  const result: HooksConfig["hooks"] = {};
  if (!Array.isArray(hooks)) {
    return result;
  }
  for (const raw of hooks) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.event !== "string" || typeof entry.command !== "string") {
      continue;
    }
    const event = KIMI_CODE_TO_CANONICAL_EVENT_NAMES[entry.event] ?? entry.event;
    const definition: HookDefinition = {
      type: "command",
      command: stripTrustedDirectoryWrapper(entry.command),
      ...(typeof entry.matcher === "string" && { matcher: entry.matcher }),
      ...(typeof entry.timeout === "number" && { timeout: entry.timeout }),
    };
    (result[event] ??= []).push(definition);
  }
  return result;
}

/**
 * Kimi Code lifecycle hooks in the shared user `config.toml`.
 *
 * Kimi Code documents hooks only at user scope. The config file also contains
 * models, providers, permissions, and other settings, so the hooks patch is
 * merged in place and the file is never deleted.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/hooks.html
 */
export class KimiCodeHooks extends ToolHooks {
  constructor(params: KimiCodeHooksParams) {
    super({
      ...params,
      ...KimiCodeHooks.getSettablePaths({ global: params.global ?? true }),
    });
  }

  static getSettablePaths({ global = true }: { global?: boolean } = {}) {
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({ global }),
      relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * `config.toml` under both spellings its directory can take.
   * @see getKimiCodeSharedConfigWritePaths
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return getKimiCodeSharedConfigWritePaths();
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    const paths = KimiCodeHooks.getSettablePaths({ global: this.global });
    this.fileContent = applySharedConfigPatch({
      fileKey: getKimiCodeConfigSharedFileKey({ global: this.global }),
      feature: "hooks",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "toml", fileContent: this.fileContent }),
      filePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = true,
  }: ToolHooksFromFileParams): Promise<KimiCodeHooks> {
    const paths = this.getSettablePaths({ global });
    return new KimiCodeHooks({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global,
    });
  }

  static fromRulesyncHooks({
    outputRoot,
    rulesyncHooks,
    logger,
  }: ToolHooksFromRulesyncHooksParams & { logger?: Logger }): KimiCodeHooks {
    const config = rulesyncHooks.getJson();
    return new KimiCodeHooks({
      outputRoot,
      fileContent: stringifySharedConfig({
        format: "toml",
        document: {
          hooks: canonicalToKimiCodeHooks({
            config,
            toolOverrideHooks: config["kimi-code"]?.hooks,
            trustedDirectory: resolve(rulesyncHooks.getOutputRoot()),
            logger,
          }),
        },
      }),
      global: true,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const config = parseSharedConfig({ format: "toml", fileContent: this.getFileContent() });
    return new RulesyncHooks({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
      fileContent: JSON.stringify(
        buildImportedHooksConfig({
          hooks: kimiCodeHooksToCanonical(config.hooks),
          overrideKey: "kimi-code",
        }),
        null,
        2,
      ),
    });
  }

  static forDeletion({ outputRoot = process.cwd() }: ToolHooksForDeletionParams): KimiCodeHooks {
    return new KimiCodeHooks({
      outputRoot,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}
