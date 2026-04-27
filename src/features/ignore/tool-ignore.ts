import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { AiFileFromFileParams, AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { FeatureOptions } from "../../types/features.js";
import { ToolFile } from "../../types/tool-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

export type ToolIgnoreParams = AiFileParams;

/**
 * Optional per-feature options forwarded from rulesync configuration
 * (e.g. `features.<target>.ignore = { ... }`). Each tool decides how to
 * interpret its own keys; unknown keys are ignored.
 */
export type ToolIgnoreFeatureOptions = FeatureOptions;

export type ToolIgnoreFromRulesyncIgnoreParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncIgnore: RulesyncIgnore;
  options?: ToolIgnoreFeatureOptions;
};

export type ToolIgnoreSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type ToolIgnoreFromFileParams = Pick<AiFileFromFileParams, "outputRoot" | "validate"> & {
  options?: ToolIgnoreFeatureOptions;
};

export type ToolIgnoreForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
};

export type ToolIgnoreSettablePathsParams = {
  options?: ToolIgnoreFeatureOptions;
};
export abstract class ToolIgnore extends ToolFile {
  protected patterns: string[];

  constructor(params: ToolIgnoreParams) {
    super({
      ...params,
      validate: true,
    });
    this.patterns = this.fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Validate after setting patterns, if validation was requested
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(_params?: ToolIgnoreSettablePathsParams): ToolIgnoreSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  getPatterns(): string[] {
    return this.patterns;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static fromRulesyncIgnore(
    _params: ToolIgnoreFromRulesyncIgnoreParams,
  ): ToolIgnore | Promise<ToolIgnore> {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncIgnore(): RulesyncIgnore;

  protected toRulesyncIgnoreDefault(): RulesyncIgnore {
    return new RulesyncIgnore({
      outputRoot: ".",
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      fileContent: this.fileContent,
    });
  }

  static async fromFile(_params: ToolIgnoreFromFileParams): Promise<ToolIgnore> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params: ToolIgnoreForDeletionParams): ToolIgnore {
    throw new Error("Please implement this method in the subclass.");
  }
}
