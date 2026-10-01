import { join } from "node:path";

import {
  ZCODE_PLUGIN_HOOKS_DIR,
  ZCODE_PLUGIN_HOOKS_FILE_NAME,
} from "../../constants/plugin-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
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
import { stripProcessHooks, ZCODE_CONVERTER_CONFIG } from "./zcode-hooks.js";

/**
 * ZCode's native hook conversion, with commands anchored to the plugin install
 * directory: ZCode substitutes `${ZCODE_PLUGIN_ROOT}` in a plugin hook command
 * and exports `ZCODE_PLUGIN_ROOT` to it, while the hook itself runs with the
 * consumer's project as its working directory, where a `./`-relative script
 * shipped in the plugin does not exist.
 */
const ZCODE_PLUGIN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  ...ZCODE_CONVERTER_CONFIG,
  projectDirVar: "$ZCODE_PLUGIN_ROOT",
  prefixDotRelativeCommandsOnly: true,
};

function parseHooksFile(fileContent: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse ZCode plugin hooks in ${filePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new Error(`Failed to parse ZCode plugin hooks in ${filePath}: expected a JSON object`);
  }
  return parsed;
}

/**
 * Hooks inside a ZCode plugin bundle: `<plugin>/hooks/hooks.json`, holding the
 * event map directly under `hooks` (`{ "hooks": { "<Event>": [...] } }`) with
 * the same events and hook fields as ZCode's own config, but without the
 * `enabled`/`events` wrapper of `.zcode/config.json`. The bundle is generated
 * in full by rulesync, so the file is written whole and may be deleted.
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginHooks extends ToolHooks {
  override isDeletable(): boolean {
    return true;
  }

  static getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: ZCODE_PLUGIN_HOOKS_DIR,
      relativeFilePath: ZCODE_PLUGIN_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolHooksFromFileParams): Promise<ZcodePluginHooks> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new ZcodePluginHooks({
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<ZcodePluginHooks> {
    const paths = this.getSettablePaths();
    const config = rulesyncHooks.getJson();
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.zcode?.hooks,
      converterConfig: ZCODE_PLUGIN_CONVERTER_CONFIG,
      logger,
    });
    return new ZcodePluginHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ hooks }, null, 2),
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const settings = parseHooksFile(
      this.getFileContent(),
      join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    );
    const hooks = toolHooksToCanonical({
      hooks: stripProcessHooks({ events: settings.hooks, logger }),
      converterConfig: ZCODE_PLUGIN_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "zcode" }),
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
  }: ToolHooksForDeletionParams): ZcodePluginHooks {
    return new ZcodePluginHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
