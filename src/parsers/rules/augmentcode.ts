import { basename, join } from "node:path";
import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import {
  extractArrayField,
  extractStringField,
  parseFrontmatter,
} from "../../utils/frontmatter.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for AugmentCode rule files (.augment/rules/ and legacy .augment-guidelines)
 */
export class AugmentCodeRuleParser extends BaseRuleParser {
  getToolName() {
    return "augmentcode" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".augment/rules/*.md", ".augment/rules/*.mdc", ".augment-guidelines"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Try modern format first
    await this.parseModernRules(baseDir, result);

    // Try legacy format if no modern rules found
    if (result.rules.length === 0) {
      await this.parseLegacyGuidelines(baseDir, result);
    }

    return result;
  }

  private async parseModernRules(baseDir: string, result: RuleParseResult): Promise<void> {
    const rulesDir = join(baseDir, ".augment", "rules");
    if (!(await fileExists(rulesDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(rulesDir);

      for (const file of files) {
        if (file.endsWith(".md") || file.endsWith(".mdc")) {
          const filePath = join(rulesDir, file);
          await this.parseRuleFile(filePath, result);
        }
      }
    }, "Failed to read .augment/rules directory");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseRuleFile(filePath: string, result: RuleParseResult): Promise<void> {
    const parseResult = await safeAsyncOperation(async () => {
      const rawContent = await readFileContent(filePath);
      const parsed = parseFrontmatter(rawContent);

      // Parse frontmatter
      const ruleType = extractStringField(parsed.data, "type", "manual");
      const description = extractStringField(parsed.data, "description", "");
      const tags = extractArrayField(parsed.data, "tags");

      // Determine if this should be a root rule based on type
      const isRoot = ruleType === "always"; // Always rules become root rules

      const filename = basename(filePath, filePath.endsWith(".mdc") ? ".mdc" : ".md");
      const frontmatter: RuleFrontmatter = {
        root: isRoot,
        targets: ["augmentcode"],
        description: description,
        globs: ["**/*"], // AugmentCode doesn't use specific globs in the same way
        ...(tags.length > 0 && { tags }),
      };

      result.rules.push({
        frontmatter,
        content: parsed.content.trim(),
        filename: `augmentcode-${ruleType}-${filename}`,
        filepath: filePath,
      });
    }, `Failed to parse ${filePath}`);

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseLegacyGuidelines(baseDir: string, result: RuleParseResult): Promise<void> {
    const guidelinesPath = join(baseDir, ".augment-guidelines");
    if (!(await fileExists(guidelinesPath))) {
      result.errors.push(
        "No AugmentCode configuration found. Expected .augment/rules directory or .augment-guidelines file.",
      );
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(guidelinesPath);

      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true, // Legacy guidelines become root rules
          targets: ["augmentcode"],
          description: "Legacy AugmentCode guidelines",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "augmentcode-guidelines",
          filepath: guidelinesPath,
        });
      }
    }, "Failed to parse .augment-guidelines");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
