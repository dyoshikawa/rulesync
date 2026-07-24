import { join } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME, KIMI_CODE_DIR } from "../../constants/kimi-code-paths.js";
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
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
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
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
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
        command: definition.command,
        ...(definition.matcher && { matcher: definition.matcher }),
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
      command: entry.command,
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
      ...KimiCodeHooks.getSettablePaths(),
    });
  }

  static getSettablePaths() {
    return {
      relativeDirPath: KIMI_CODE_DIR,
      relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    const paths = KimiCodeHooks.getSettablePaths();
    this.fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "toml", fileContent: this.fileContent }),
      filePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolHooksFromFileParams): Promise<KimiCodeHooks> {
    const paths = this.getSettablePaths();
    return new KimiCodeHooks({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global: true,
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
            logger,
          }),
        },
      }),
      global: true,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const config = parseSharedConfig({ format: "toml", fileContent: this.getFileContent() });
    return this.toRulesyncHooksDefault({
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
