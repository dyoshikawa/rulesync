import { join } from "node:path";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_HOOKS_FILE_NAME,
  FACTORYDROID_SETTINGS_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  FACTORYDROID_HOOK_EVENTS,
  FACTORYDROID_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_FACTORYDROID_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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

const FACTORYDROID_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: FACTORYDROID_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_FACTORYDROID_EVENT_NAMES,
  toolToCanonicalEventNames: FACTORYDROID_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$FACTORY_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  // Droid's hooks reference states "Currently only \"command\" is supported".
  // Filtering prompt-type hooks here (instead of accepting them) surfaces the
  // processor's skipped-type warning rather than writing an inert entry.
  supportedHookTypes: new Set(["command"]),
  // "Additional regex filter for Execute commands. It matches the actual shell
  // command string when Droid has one. Invalid regex values are skipped." It
  // sits next to `matcher` on the group, so it is carried at group level.
  // https://docs.factory.ai/reference/hooks-reference
  // It narrows when a hook fires, so hooks that disagree get their own matcher
  // entry rather than inheriting a neighboring hook's filter and going quiet.
  groupPassthroughFields: [
    {
      canonical: "commandRegex",
      tool: "commandRegex",
      valueType: "string",
      subdividesGroup: true,
    },
  ],
};

export class FactorydroidHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Factory Droid's primary hooks file is `.factory/hooks.json` (project) and
    // `~/.factory/hooks.json` (global). The home directory is resolved by the
    // harness via outputRoot in global mode. The legacy `.factory/settings.json`
    // `hooks` key is only a read-time fallback (see fromFile).
    // https://docs.factory.ai/reference/hooks-reference
    return { relativeDirPath: FACTORYDROID_DIR, relativeFilePath: FACTORYDROID_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<FactorydroidHooks> {
    const paths = FactorydroidHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Prefer the dedicated `.factory/hooks.json`. When it is absent, fall back to
    // the legacy `.factory/settings.json` `hooks` key for back-compat, since
    // Droid itself falls back that way.
    let fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      const legacyFilePath = join(
        outputRoot,
        paths.relativeDirPath,
        FACTORYDROID_SETTINGS_FILE_NAME,
      );
      fileContent = await readFileContentOrNull(legacyFilePath);
    }
    return new FactorydroidHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: fileContent ?? '{"hooks":{}}',
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
  }): Promise<FactorydroidHooks> {
    const paths = FactorydroidHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Factory Droid hooks file at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const factorydroidHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.factorydroid?.hooks,
      converterConfig: FACTORYDROID_CONVERTER_CONFIG,
      logger,
    });
    const merged = { ...settings, hooks: factorydroidHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new FactorydroidHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Factory Droid hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: FACTORYDROID_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "factorydroid" }),
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
  }: ToolHooksForDeletionParams): FactorydroidHooks {
    return new FactorydroidHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
