import { join } from "node:path";

import {
  AUGMENTCODE_PLUGIN_HOOKS_DIR,
  AUGMENTCODE_PLUGIN_HOOKS_FILE_NAME,
} from "../../constants/plugin-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { parseAugmentcodeSettingsDocument } from "../../utils/augmentcode-settings.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AUGMENTCODE_CONVERTER_CONFIG } from "./augmentcode-hooks.js";
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
 * Plugin hook scripts ship inside the plugin, so a dot-relative command is
 * anchored to the plugin install directory rather than run verbatim against
 * the consumer's workspace. Auggie sets `AUGMENT_PLUGIN_ROOT` in the hook
 * process environment and runs a command containing `$` through `bash -c`, and
 * it substitutes the braced `${AUGMENT_PLUGIN_ROOT}` itself in the exec form
 * (`args`). Bare commands such as `npx prettier --write` are left intact.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
const AUGMENTCODE_PLUGIN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  ...AUGMENTCODE_CONVERTER_CONFIG,
  projectDirVar: "$AUGMENT_PLUGIN_ROOT",
  prefixDotRelativeCommandsOnly: true,
};

/**
 * Hooks inside an Auggie plugin bundle (`<plugin>/hooks/hooks.json`), in the
 * same `{ "hooks": { "<Event>": [...] } }` shape as the `hooks` key of
 * `.augment/settings.json`.
 *
 * The plugin bundle is generated in full by rulesync, so the file is written
 * wholesale rather than merged, and `--delete` may remove it.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginHooks extends ToolHooks {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: AUGMENTCODE_PLUGIN_HOOKS_DIR,
      relativeFilePath: AUGMENTCODE_PLUGIN_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolHooksFromFileParams): Promise<AugmentcodePluginHooks> {
    const paths = this.getSettablePaths();
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"hooks":{}}';
    return new AugmentcodePluginHooks({
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
  }): Promise<AugmentcodePluginHooks> {
    const paths = this.getSettablePaths();
    const config = rulesyncHooks.getJson();
    // Plugin components are written in the `augmentcode` format, so the
    // `augmentcode` override block applies here too.
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.augmentcode?.hooks,
      converterConfig: AUGMENTCODE_PLUGIN_CONVERTER_CONFIG,
      logger,
    });
    return new AugmentcodePluginHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ hooks }, null, 2),
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const configPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    let parsed: Record<string, unknown>;
    try {
      parsed = parseAugmentcodeSettingsDocument({
        fileContent: this.getFileContent(),
        configPath,
      });
    } catch (error) {
      throw new Error(
        `Failed to parse AugmentCode plugin hooks content in ${configPath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: parsed.hooks,
      converterConfig: AUGMENTCODE_PLUGIN_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "augmentcode" }),
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
  }: ToolHooksForDeletionParams): AugmentcodePluginHooks {
    return new AugmentcodePluginHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
