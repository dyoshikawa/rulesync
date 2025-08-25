import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for OpenCode rule files (AGENTS.md)
 */
export class OpenCodeRuleParser extends BaseRuleParser {
  getToolName() {
    return "opencode" as const;
  }

  getRuleFilesPattern(): string {
    return "AGENTS.md";
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    const agentsPath = resolvePath("AGENTS.md", baseDir);
    if (!(await fileExists(agentsPath))) {
      // Not an error - AGENTS.md is optional
      return result;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(agentsPath);

      if (!content.trim()) {
        return;
      }

      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["opencode"],
        description: "OpenCode configuration",
        globs: ["**/*"],
      };

      result.rules.push({
        frontmatter,
        content: content.trim(),
        filename: "agents",
        filepath: agentsPath,
      });
    }, "Failed to parse AGENTS.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }

    return result;
  }
}
