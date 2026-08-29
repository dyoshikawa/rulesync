import { join } from "node:path";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_HOOKS_FILE_NAME,
  FACTORYDROID_LEGACY_HOOKS_DIR_PATH,
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
import { readFactorydroidSettingsWithLocalOverlay } from "../../utils/factorydroid-settings.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
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

/**
 * Whether a `settings.json` body carries hook declarations, i.e. an object under
 * the `hooks` key — the only place Droid reads them from that file. A body that
 * cannot be parsed counts as declaring them, so a malformed settings file still
 * reaches the constructor and reports its own error rather than being skipped.
 */
function declaresHooksKey(fileContent: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return true;
  }
  return isRecord(parsed) && isRecord(parsed["hooks"]);
}

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
  // https://docs.factory.ai/harness/hooks
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

/** Droid's nine event names, the keys a standalone `hooks.json` is made of. */
const FACTORYDROID_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(CANONICAL_TO_FACTORYDROID_EVENT_NAMES),
);

/**
 * Whether a parsed hooks file is the standalone shape — keyed directly by event
 * name — rather than the `settings.json` shape that wraps the same map in a
 * `hooks` key.
 */
function hasFactorydroidEventKey(parsed: object): boolean {
  return Object.keys(parsed).some((key) => FACTORYDROID_EVENT_NAMES.has(key));
}

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
    // https://docs.factory.ai/harness/hooks
    return { relativeDirPath: FACTORYDROID_DIR, relativeFilePath: FACTORYDROID_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromFileParams): Promise<FactorydroidHooks> {
    const paths = FactorydroidHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Prefer the dedicated `.factory/hooks.json`. When it is absent, fall back
    // first to the `.factory/settings.json` `hooks` key — with the scope's
    // `settings.local.json` overlaid, since Droid reads the pair as one — and
    // then to the pre-1.0 `.factory/hooks/hooks.json`. That layout is last
    // because Droid renames it to `hooks.migrated.json` once it has migrated
    // the file, so a copy still sitting there is the least likely to be live.
    // https://docs.factory.ai/harness/hooks
    let fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      const settingsContent = await readFactorydroidSettingsWithLocalOverlay({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        baseFileName: FACTORYDROID_SETTINGS_FILE_NAME,
        logger,
      });
      // The settings step is skipped unless the settings actually declare
      // hooks. Testing the file for existence instead would let an unrelated
      // `settings.local.json` — one setting an autonomy level, say — shadow the
      // pre-1.0 layout, because the overlay returns merged content whenever
      // either file of the pair is there.
      if (settingsContent !== null && declaresHooksKey(settingsContent)) {
        fileContent = settingsContent;
      }
    }
    if (fileContent === null) {
      fileContent = await readFileContentOrNull(
        join(outputRoot, FACTORYDROID_LEGACY_HOOKS_DIR_PATH, FACTORYDROID_HOOKS_FILE_NAME),
      );
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
    const config = rulesyncHooks.getJson();
    const factorydroidHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.factorydroid?.hooks,
      converterConfig: FACTORYDROID_CONVERTER_CONFIG,
      logger,
    });
    // A standalone `hooks.json` is keyed directly by event name; the `hooks`
    // wrapper belongs to `settings.json` only. Writing the wrapped shape here
    // left Droid with no known event key at the top level, so no generated hook
    // ever fired. https://docs.factory.ai/harness/hooks
    const fileContent = JSON.stringify(factorydroidHooks, null, 2);
    return new FactorydroidHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    let parsed: { hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Factory Droid hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    // Both shapes are read: a standalone `hooks.json` keyed by event name, and
    // the `hooks`-wrapped `settings.json` that `fromFile` falls back to. The
    // top level wins when it names an event, so a file carrying an event
    // literally called `hooks` is not mistaken for the wrapped form.
    const hooks = toolHooksToCanonical({
      hooks: hasFactorydroidEventKey(parsed) ? parsed : parsed.hooks,
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
