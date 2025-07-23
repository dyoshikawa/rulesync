import type { ParsedRule } from "../types/index.js";

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

export function handleParseError(error: unknown, context: string): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `${context}: ${errorMessage}`;
}

export async function safeReadFile<T>(
  operation: () => Promise<T>,
  errorContext: string,
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const result = await operation();
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: handleParseError(error, errorContext),
    };
  }
}
