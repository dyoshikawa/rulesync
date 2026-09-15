import { join } from "node:path";

import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import type { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { HOOKS_OWNERSHIP_LOCK_FILE_NAME, parseHooksOwnershipLock } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";
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
  type ToolHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * The tool-specific half of a Claude-Code-compatible `settings.json` hooks
 * adapter. Everything else — reading the file, merging the `hooks` key into it
 * through the shared-config gateway, converting in both directions with the
 * shared converter, deletion — is the same for every such tool and lives in
 * {@link SettingsJsonHooks}.
 */
export type SettingsJsonHooksSpec = {
  /** How the tool is named in error messages ("Cortex Code", "Continue"). */
  readonly displayName: string;
  /**
   * The tool's override key in `.rulesync/hooks.*` (`cortexcode` for
   * `cortexcode.hooks`): read on generate, and written back on import for
   * events the canonical model does not know.
   */
  readonly overrideKey: string;
  readonly converterConfig: ToolHooksConverterConfig;
};

/**
 * Shared implementation for the tools whose hooks live under the top-level
 * `hooks` key of a JSON settings file in Claude Code's shape —
 * `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{ "type": "command", ... }] }] }`
 * — and whose file also holds settings rulesync does not own, so generation
 * merges the `hooks` key into it (see `SHARED_CONFIG_OWNERSHIP`) instead of
 * overwriting it, and `--delete` never removes the file wholesale.
 *
 * A concrete adapter supplies its {@link SettingsJsonHooksSpec} and its
 * settable paths; the event mapping, the matcher rules and the per-hook
 * fields the tool documents are all expressed in the spec's converter config.
 * An adapter that also supports preserving unowned hooks (Claude Code) opts in
 * through {@link ToolHooks.supportsPreserveUnowned}.
 */
export abstract class SettingsJsonHooks extends ToolHooks {
  constructor(params: ToolHooksParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // The settings file carries user-managed settings beyond hooks, so it is
    // never removed wholesale; clearing hooks happens via an in-place merge.
    return false;
  }

  /** The tool-specific half of the adapter. Every concrete class overrides this. */
  static getSpec(): SettingsJsonHooksSpec {
    throw new Error(`${this.name} does not define getSpec()`);
  }

  /**
   * The converter config used for both directions. A separate hook so a
   * subclass can swap tool-specific details (e.g. the project directory
   * variable) without redefining the whole spec.
   */
  static getConverterConfig(): ToolHooksConverterConfig {
    return this.getSpec().converterConfig;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    throw new Error(`${this.name} does not define getSettablePaths()`);
  }

  /**
   * The `SHARED_CONFIG_OWNERSHIP` key the settings file is merged under. By
   * default it is derived from the settable paths; an adapter whose file is
   * declared under another tool's key (the Claude Code plugin bundle) overrides
   * it.
   */
  static getSharedFileKey(paths: ToolHooksSettablePaths): string {
    return sharedConfigFileKey(paths);
  }

  /**
   * `new this(params)` for the concrete adapter the static method was called
   * on; the cast is what an abstract class needs to be constructed through
   * `this`, and lives in one place.
   */
  private static instantiate(params: ToolHooksParams): SettingsJsonHooks {
    const ctor = this as unknown as new (p: ToolHooksParams) => SettingsJsonHooks;
    return new ctor(params);
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<SettingsJsonHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return this.instantiate({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static override async getAuxiliaryFiles({
    toolHooks,
  }: {
    outputRoot?: string;
    global?: boolean;
    toolHooks?: ToolHooks;
    logger?: Logger;
  } = {}): Promise<ToolFile[]> {
    return toolHooks instanceof this ? toolHooks.getOwnershipLockFiles() : [];
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<SettingsJsonHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const generatedHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: overrideHooksOf({ config, overrideKey: this.getSpec().overrideKey }),
      converterConfig: this.getConverterConfig(),
      logger,
    });
    const preserving = preserveUnowned && this.supportsPreserveUnowned();
    const previouslyOwned = preserving
      ? parseHooksOwnershipLock(
          await readFileContentOrNull(
            join(outputRoot, paths.relativeDirPath, HOOKS_OWNERSHIP_LOCK_FILE_NAME),
          ),
        )
      : undefined;
    const merged = mergeGeneratedHookLists({
      existingContent,
      generatedHooks,
      shape: "matcher-groups",
      preserveUnowned: preserving,
      previouslyOwned,
      logger,
    });
    const fileContent = applySharedConfigPatch({
      fileKey: this.getSharedFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks: merged.hooks },
      filePath,
      logger,
    });
    return this.instantiate({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserving ? merged.owned : undefined,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const ctor = this.constructor as typeof SettingsJsonHooks;
    const spec = ctor.getSpec();
    const configPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    let settings: Record<string, unknown>;
    try {
      // Fail closed on an unparseable root rather than reading a partial file.
      settings = parseSharedConfig({
        format: "json",
        fileContent: this.getFileContent(),
        filePath: configPath,
        invalidRootPolicy: "error",
      });
    } catch (error) {
      // `parseSharedConfig` carries the bare reason as `cause` so the file is
      // named once, by this prefix, rather than by both.
      const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      throw new Error(
        `Failed to parse ${spec.displayName} hooks content in ${configPath}: ${formatError(reason)}`,
        { cause: error },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: ctor.getConverterConfig(),
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: spec.overrideKey }),
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
  }: ToolHooksForDeletionParams): SettingsJsonHooks {
    return this.instantiate({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * The `hooks` map of a tool's override block (`config.<overrideKey>.hooks`),
 * or `undefined` when the block states none. The schema keeps every override
 * block loose, so the lookup goes through the record form.
 */
function overrideHooksOf({
  config,
  overrideKey,
}: {
  config: HooksConfig;
  overrideKey: string;
}): HooksConfig["hooks"] | undefined {
  const override = lookupOwn({ record: config as Record<string, unknown>, key: overrideKey });
  if (!isPlainObject(override)) {
    return undefined;
  }
  const hooks = override.hooks;
  return isPlainObject(hooks) ? (hooks as HooksConfig["hooks"]) : undefined;
}
