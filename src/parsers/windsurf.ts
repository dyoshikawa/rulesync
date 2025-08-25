import type { ParsedRule } from "../types/index.js";
import { getRuleParser } from "./rules/index.js";

export interface ImportOptions {
  ignoreErrors?: boolean;
}

export async function importWindsurfRules(
  sourceDir: string,
  options: ImportOptions = {},
): Promise<ParsedRule[]> {
  const ruleParser = getRuleParser("windsurf");
  if (!ruleParser) {
    return [];
  }

  const result = await ruleParser.parseRules(sourceDir);

  if (!options.ignoreErrors && result.errors.length > 0) {
    throw new Error(`Failed to import Windsurf rules: ${result.errors.join(", ")}`);
  }

  return result.rules;
}
