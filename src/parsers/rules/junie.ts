import { join } from "node:path";
import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for JetBrains Junie rule files (.junie/guidelines.md)
 */
export class JunieRuleParser extends BaseRuleParser {
  getToolName() {
    return "junie" as const;
  }

  getRuleFilesPattern(): string {
    return ".junie/guidelines.md";
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    const guidelinesPath = join(baseDir, ".junie", "guidelines.md");

    if (!(await fileExists(guidelinesPath))) {
      result.errors.push(".junie/guidelines.md file not found");
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(guidelinesPath);

      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: false,
          targets: ["junie"],
          description: "Junie project guidelines",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "junie-guidelines",
          filepath: guidelinesPath,
        });
      }
    }, "Failed to parse .junie/guidelines.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    if (result.rules.length === 0) {
      result.errors.push("No valid Junie configuration found");
    }

    return result;
  }
}
