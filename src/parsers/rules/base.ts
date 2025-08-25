import type { ParsedRule } from "../../types/index.js";
import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Result of parsing rules
 */
export interface RuleParseResult {
  rules: ParsedRule[];
  errors: string[];
}

/**
 * Abstract base class for rule parsers
 */
export abstract class BaseRuleParser {
  /**
   * Get the tool name this parser is for
   */
  abstract getToolName(): ToolTarget;

  /**
   * Get the rule file name(s) or directory this parser looks for
   */
  abstract getRuleFilesPattern(): string | string[];

  /**
   * Parse rules from the given base directory
   */
  abstract parseRules(baseDir: string): Promise<RuleParseResult>;

  /**
   * Optional: tool-specific validation for rule data
   */
  validateRule?(rule: ParsedRule): boolean;

  /**
   * Optional: tool-specific transformation for rule data
   */
  transformRule?(rule: ParsedRule): ParsedRule;

  /**
   * Combine multiple rule parse results
   */
  protected combineResults(...results: RuleParseResult[]): RuleParseResult {
    const combined: RuleParseResult = {
      rules: [],
      errors: [],
    };

    for (const result of results) {
      combined.rules.push(...result.rules);
      combined.errors.push(...result.errors);
    }

    return combined;
  }
}
