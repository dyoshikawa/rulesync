import { join } from "node:path";
import type { RuleFrontmatter, ParsedRule } from "../../types/index.js";
import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { extractArrayField, extractStringField, parseFrontmatter } from "../../utils/frontmatter.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for GitHub Copilot rule files
 */
export class CopilotRuleParser extends BaseRuleParser {
  getToolName() {
    return "copilot" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".github/copilot-instructions.md", ".github/instructions/*.instructions.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse main copilot-instructions.md file
    await this.parseMainFile(baseDir, result);

    // Parse .instructions.md files
    await this.parseInstructionFiles(baseDir, result);

    return result;
  }

  private async parseMainFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const mainFilePath = join(baseDir, ".github", "copilot-instructions.md");
    if (!(await fileExists(mainFilePath))) {
      // Not an error - file is optional
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(mainFilePath);
      
      if (!content.trim()) {
        return;
      }

      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["copilot"],
        description: "GitHub Copilot custom instructions",
        globs: ["**/*"],
      };

      result.rules.push({
        frontmatter,
        content: content.trim(),
        filename: "copilot-instructions",
        filepath: mainFilePath,
      });
    }, "Failed to parse .github/copilot-instructions.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseInstructionFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const instructionsDir = join(baseDir, ".github", "instructions");
    if (!(await fileExists(instructionsDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(instructionsDir);

      for (const file of files) {
        if (file.endsWith(".instructions.md")) {
          const filePath = join(instructionsDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const rawContent = await readFileContent(filePath);
            const parsed = parseFrontmatter(rawContent);
            const content = parsed.content;

            if (content) {
              const filename = file.replace(/\.instructions\.md$/, "");
              
              const frontmatter: RuleFrontmatter = {
                root: false,
                targets: ["copilot"],
                description: extractStringField(
                  parsed.data,
                  "description",
                  `GitHub Copilot instruction: ${filename}`,
                ),
                globs: extractArrayField(parsed.data, "globs", ["**/*"]),
              };

              // Add tags only if they exist
              const tags = extractArrayField(parsed.data, "tags");
              if (tags.length > 0) {
                frontmatter.tags = tags;
              }

              result.rules.push({
                frontmatter,
                content: content.trim(),
                filename: `copilot-${filename}`,
                filepath: filePath,
              });
            }
          }, `Failed to parse ${filePath}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse .github/instructions files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
