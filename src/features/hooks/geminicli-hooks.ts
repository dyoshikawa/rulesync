import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  GEMINICLI_HOOK_EVENTS,
  GEMINICLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_GEMINICLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import { canonicalToToolHooks, toolHooksToCanonical } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const GEMINICLI_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GEMINICLI_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GEMINICLI_EVENT_NAMES,
  toolToCanonicalEventNames: GEMINICLI_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$GEMINI_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  passthroughHookFields: ["name", "description"],
};

/**
 * Convert canonical hooks config to Gemini CLI format.
 */
function canonicalToGeminicliHooks(config: HooksConfig): Record<string, unknown[]> {
  return canonicalToToolHooks({
    config,
    toolOverrideHooks: config.geminicli?.hooks,
    converterConfig: GEMINICLI_CONVERTER_CONFIG,
  });
}

/**
 * Extract hooks from Gemini CLI settings.json into canonical format.
 */
function geminiHooksToCanonical(geminiHooks: unknown): HooksConfig["hooks"] {
  return toolHooksToCanonical({
    hooks: geminiHooks,
    converterConfig: GEMINICLI_CONVERTER_CONFIG,
  });
}

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
    return { relativeDirPath: ".gemini", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GeminicliHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<GeminicliHooks> {
    const paths = GeminicliHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Gemini CLI settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const geminiHooks = canonicalToGeminicliHooks(config);
    const merged = { ...settings, hooks: geminiHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new GeminicliHooks({
      baseDir,
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
    const hooks = geminiHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): GeminicliHooks {
    return new GeminicliHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
