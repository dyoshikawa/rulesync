import {
  AiFile,
  AiFileFromFilePathParams,
  AiFileParams,
  ValidationResult,
} from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

export type ToolIgnoreParams = AiFileParams;

export type ToolIgnoreFromRulesyncIgnoreParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncIgnore: RulesyncIgnore;
};

export type ToolIgnoreFromFilePathParams = Omit<
  AiFileFromFilePathParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  filePath: string;
};

export abstract class ToolIgnore extends AiFile {
  protected readonly patterns: string[];

  constructor({ ...rest }: ToolIgnoreParams) {
    super({
      ...rest,
      validate: true, // Skip validation during construction
    });
    this.patterns = this.fileContent
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Validate after setting patterns, if validation was requested
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  getPatterns(): string[] {
    return this.patterns;
  }

  validate(): ValidationResult {
    // Basic validation for patterns array
    if (this.patterns === undefined || this.patterns === null) {
      return { success: false, error: new Error("Patterns must be defined") };
    }
    if (!Array.isArray(this.patterns)) {
      return { success: false, error: new Error("Patterns must be an array") };
    }
    return { success: true, error: null };
  }

  abstract toRulesyncIgnore(): RulesyncIgnore;

  static async fromFilePath(_params: ToolIgnoreFromFilePathParams): Promise<ToolIgnore> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncIgnore(_params: ToolIgnoreFromRulesyncIgnoreParams): ToolIgnore {
    throw new Error("Please implement this method in the subclass.");
  }
}
