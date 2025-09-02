import { AiFile, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

export type ToolIgnoreParams = {
  patterns: string[];
} & AiFileParams;

export type ToolIgnoreFromRulesyncIgnoreParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncIgnore: RulesyncIgnore;
};

export abstract class ToolIgnore extends AiFile {
  protected readonly patterns: string[];

  constructor({ patterns, ...rest }: ToolIgnoreParams) {
    super({
      ...rest,
      validate: true, // Skip validation during construction
    });
    this.patterns = patterns;

    // Validate after setting patterns, if validation was requested
    if (rest.validate !== false) {
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

  static async fromFilePath(_params: { filePath: string }): Promise<ToolIgnore> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncIgnore(_params: ToolIgnoreFromRulesyncIgnoreParams): ToolIgnore {
    throw new Error("Please implement this method in the subclass.");
  }
}
