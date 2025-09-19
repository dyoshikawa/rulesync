import { AiFileFromFileParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

export type ToolIgnoreParams = AiFileParams;

export type ToolIgnoreFromRulesyncIgnoreParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncIgnore: RulesyncIgnore;
};

export type ToolIgnoreSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type ToolIgnoreFromFileParams = Pick<AiFileFromFileParams, "baseDir" | "validate">;
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

  static getSettablePaths(): ToolIgnoreSettablePaths {
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
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      fileContent: this.fileContent,
    });
  }

  static async fromFile(_params: ToolIgnoreFromFileParams): Promise<ToolIgnore> {
    throw new Error("Please implement this method in the subclass.");
  }
}
