export type ValidationResult =
  | {
      success: true;
      errors: [];
    }
  | {
      success: false;
      errors: {
        filePath: string;
        error: Error;
      }[];
    };

export interface RulesProcessor {
  validate(): Promise<ValidationResult>;
}

export interface ToolRulesProcessor extends RulesProcessor {
  generateAllFromRulesyncRuleFiles(): Promise<void>;
  generateAllToRulesyncRuleFiles(): Promise<void>;
  validate(): Promise<ValidationResult>;
}
