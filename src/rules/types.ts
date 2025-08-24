/**
 * Validation result for rule files
 */
export type ValidationResult =
  | {
      success: true;
      error: null;
    }
  | {
      success: false;
      error: Error;
    };

/**
 * Base interface for all rule implementations
 */
export interface Rule {
  /**
   * Build a rule from file path and content
   */
  // Note: static methods cannot be defined in TypeScript interfaces
  // These are documented here for implementation guidance
  // static build(params: {filePath: string, fileContent: string}): Rule
  // static fromFilePath(filePath: string): Promise<Rule>

  /**
   * Write the rule to file system
   */
  writeFile(): Promise<void>;

  /**
   * Validate the rule content
   */
  validate(): ValidationResult;

  /**
   * Get the file path
   */
  getFilePath(): string;

  /**
   * Get the file content
   */
  getFileContent(): string;
}

/**
 * Extended interface for tool-specific rules
 */
export interface ToolRule extends Rule {
  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule;

  // Note: static method documented for implementation guidance
  // static fromRulesyncRule(rule: RulesyncRule): ToolRule
}

/**
 * Type guard to check if a rule implements ToolRule
 */
export function isToolRule(rule: Rule): rule is ToolRule {
  return "toRulesyncRule" in rule;
}

// Forward declaration - will be implemented in RulesyncRule.ts
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RulesyncRule extends Rule {
  // Implementation will define additional properties
}
