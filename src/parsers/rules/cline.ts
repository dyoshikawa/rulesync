import { basename, join } from "node:path";
import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for Cline rule files (.cline/instructions.md and .clinerules/*.md)
 */
export class ClineRuleParser extends BaseRuleParser {
  getToolName() {
    return "cline" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".cline/instructions.md", ".clinerules/*.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse main instructions file
    await this.parseMainInstructionsFile(baseDir, result);

    // Parse rules directory
    await this.parseRulesDirectory(baseDir, result);

    if (result.rules.length === 0) {
      result.errors.push(
        "No Cline configuration files found (.cline/instructions.md or .clinerules/*.md)",
      );
    }

    return result;
  }

  private async parseMainInstructionsFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const instructionsPath = join(baseDir, ".cline", "instructions.md");
    if (!(await fileExists(instructionsPath))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(instructionsPath);

      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: false,
          targets: ["cline"],
          description: "Cline instructions",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "instructions",
          filepath: instructionsPath,
        });
      }
    }, "Failed to parse .cline/instructions.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseRulesDirectory(baseDir: string, result: RuleParseResult): Promise<void> {
    const rulesDir = join(baseDir, ".clinerules");
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
                targets: ["cline"],
                description: `Cline rule: ${filename}`,
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
    }, "Failed to parse .clinerules directory");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
