import { join } from "node:path";

import { GEMINICLI_DIR, GEMINICLI_SETTINGS_FILE_NAME } from "../../constants/geminicli-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  GEMINICLI_HOOK_EVENTS,
  GEMINICLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_GEMINICLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  GEMINICLI_SETTINGS_SHARED_FILE_KEY,
} from "../shared/shared-config-gateway.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const GEMINICLI_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([]);

const GEMINICLI_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GEMINICLI_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GEMINICLI_EVENT_NAMES,
  toolToCanonicalEventNames: GEMINICLI_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$GEMINI_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: GEMINICLI_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
  passthroughFields: ["name", "description"],
};
export class GeminicliHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Currently, both global and project mode use the same paths.
    // The parameter is kept for consistency with other ToolHooks implementations.
    return { relativeDirPath: GEMINICLI_DIR, relativeFilePath: GEMINICLI_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GeminicliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    const config = rulesyncHooks.getJson();
    const geminiHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: (config.geminicli as { hooks?: typeof config.hooks } | undefined)?.hooks,
      converterConfig: GEMINICLI_CONVERTER_CONFIG,
      logger,
    });
    for (const [eventName, definitions] of Object.entries(config.hooks)) {
      const nativeEvent = CANONICAL_TO_GEMINICLI_EVENT_NAMES[eventName] ?? eventName;
      const entries = geminiHooks[nativeEvent] as Array<Record<string, unknown>> | undefined;
      if (!entries) continue;
      for (const entry of entries) {
        const matcher = typeof entry.matcher === "string" ? entry.matcher : undefined;
        if (definitions.some((def) => def.matcher === matcher && def.sequential === true)) {
          entry.sequential = true;
        }
      }
    }
    const fileContent = applySharedConfigPatch({
      fileKey: GEMINICLI_SETTINGS_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent,
      patch: { hooks: geminiHooks },
      filePath,
    });
    return new GeminicliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Gemini CLI hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: GEMINICLI_CONVERTER_CONFIG,
    });
    if (settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)) {
      for (const [nativeEvent, rawEntries] of Object.entries(settings.hooks)) {
        const eventName = GEMINICLI_TO_CANONICAL_EVENT_NAMES[nativeEvent] ?? nativeEvent;
        const definitions = hooks[eventName];
        if (!definitions || !Array.isArray(rawEntries)) continue;
        for (const rawEntry of rawEntries) {
          if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
          const entry = rawEntry as Record<string, unknown>;
          if (entry.sequential !== true) continue;
          const matcher = typeof entry.matcher === "string" ? entry.matcher : undefined;
          for (const def of definitions.filter((candidate) => candidate.matcher === matcher)) {
            def.sequential = true;
          }
        }
      }
    }
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "geminicli" }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): GeminicliHooks {
    return new GeminicliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
