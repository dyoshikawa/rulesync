import type { ParsedRule } from "../types/index.js";
import {
  createErrorResult,
  createSuccessResult,
  formatErrorWithContext,
  type Result,
} from "./error.js";

export interface ParseResult<T = ParsedRule[]> {
  rules?: T;
  rule?: ParsedRule;
  errors: string[];
}

export function createParseResult(): ParseResult {
  return { rules: [], errors: [] };
}

export function addError(result: ParseResult, error: string): void {
  result.errors.push(error);
}

export function addRule(result: ParseResult, rule: ParsedRule): void {
  if (!result.rules) {
    result.rules = [];
  }
  result.rules.push(rule);
}

export function addRules(result: ParseResult, rules: ParsedRule[]): void {
  if (!result.rules) {
    result.rules = [];
  }
  result.rules.push(...rules);
}

/**
 * Handle parse error with context (legacy function, kept for compatibility)
 */
export function handleParseError(error: unknown, context: string): string {
  return formatErrorWithContext(error, context);
}

export async function safeReadFile<T>(
  operation: () => Promise<T>,
  errorContext: string,
): Promise<Result<T | null>> {
  try {
    const result = await operation();
    return createSuccessResult(result);
  } catch (error) {
    return createErrorResult(error, errorContext);
  }
}
