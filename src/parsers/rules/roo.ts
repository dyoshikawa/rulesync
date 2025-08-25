import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../../types/index.js";
import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for Roo Code rule files (.roo/instructions.md and .roo/rules/*.md)
 */
export class RooRuleParser extends BaseRuleParser {
  getToolName() {
    return "roo" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".roo/instructions.md", ".roo/rules/*.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse main instructions file
    await this.parseInstructionsFile(baseDir, result);

    // Parse rules directory
    await this.parseRulesDirectory(baseDir, result);

    if (result.rules.length === 0) {
      result.errors.push("No Roo Code configuration files found (.roo/instructions.md or .roo/rules/*.md)");
    }

    return result;
  }

  private async parseInstructionsFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const instructionsPath = join(baseDir, ".roo", "instructions.md");
    if (!(await fileExists(instructionsPath))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(instructionsPath);
      
      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: false,
          targets: ["roo"],
          description: "Roo Code instructions",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "instructions",
          filepath: instructionsPath,
        });
      }
    }, "Failed to parse .roo/instructions.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseRulesDirectory(baseDir: string, result: RuleParseResult): Promise<void> {
    const rulesDir = join(baseDir, ".roo", "rules");
    if (!(await fileExists(rulesDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(rulesDir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(rulesDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const content = await readFileContent(filePath);

            if (content.trim()) {
              const filename = basename(file, ".md");
              const frontmatter: RuleFrontmatter = {
                root: false,
                targets: ["roo"],
                description: `Roo rule: ${filename}`,
                globs: ["**/*"],
              };

              result.rules.push({
                frontmatter,
                content: content.trim(),
                filename: filename,
                filepath: filePath,
              });
            }
          }, `Failed to parse ${filePath}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse .roo/rules directory");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
