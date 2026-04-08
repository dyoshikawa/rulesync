import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CLAUDE_EVENT_NAMES,
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

const CLAUDE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["worktreeCreate", "worktreeRemove"]);

const CLAUDE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CLAUDE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CLAUDE_EVENT_NAMES,
  toolToCanonicalEventNames: CLAUDE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CLAUDE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CLAUDE_NO_MATCHER_EVENTS,
};

export class ClaudecodeHooks extends ToolHooks {
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
    return { relativeDirPath: ".claude", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ClaudecodeHooks> {
    const paths = ClaudecodeHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new ClaudecodeHooks({
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
  }): Promise<ClaudecodeHooks> {
    const paths = ClaudecodeHooks.getSettablePaths({ global });
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
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const claudeHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.claudecode?.hooks,
      converterConfig: CLAUDE_CONVERTER_CONFIG,
      logger,
    });
    const merged = { ...settings, hooks: claudeHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new ClaudecodeHooks({
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
        `Failed to parse Claude hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: CLAUDE_CONVERTER_CONFIG,
    });
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
  }: ToolHooksForDeletionParams): ClaudecodeHooks {
    return new ClaudecodeHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
