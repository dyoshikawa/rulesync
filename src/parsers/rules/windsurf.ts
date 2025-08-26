import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { extractStringField, parseFrontmatter } from "../../utils/frontmatter.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for Windsurf AI rule files (.windsurf-rules and .windsurf/rules/*.md)
 */
export class WindsurfRuleParser extends BaseRuleParser {
  getToolName() {
    return "windsurf" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".windsurf-rules", ".windsurf/rules/*.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse single-file variant: .windsurf-rules
    await this.parseSingleFileRules(baseDir, result);

    // Parse directory variant: .windsurf/rules/
    await this.parseDirectoryRules(baseDir, result);

    return result;
  }

  private async parseSingleFileRules(baseDir: string, result: RuleParseResult): Promise<void> {
    const singleFilePath = join(baseDir, ".windsurf-rules");

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFile(singleFilePath, "utf-8");
      const parsed = this.parseWindsurfRule(content, ".windsurf-rules", singleFilePath);
      if (parsed) {
        result.rules.push(parsed);
      }
    }, "Failed to parse .windsurf-rules");

    if (!parseResult.success) {
      // Not an error - file is optional
    }
  }

  private async parseDirectoryRules(baseDir: string, result: RuleParseResult): Promise<void> {
    const rulesDir = join(baseDir, ".windsurf", "rules");

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(rulesDir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(rulesDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const content = await readFile(filePath, "utf-8");
            const parsed = this.parseWindsurfRule(content, file, filePath);
            if (parsed) {
              result.rules.push(parsed);
            }
          }, `Failed to parse ${filePath}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse .windsurf/rules directory");

    if (!parseResult.success) {
      // Not an error - directory is optional
    }
  }

  private parseWindsurfRule(
    content: string,
    filename: string,
    filepath: string,
  ): ParsedRule | null {
    try {
      const parsed = parseFrontmatter(content);
      const markdownContent = parsed.content;

      // Create default frontmatter
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["windsurf"],
        description: filename.replace(/\.md$/, ""),
        globs: [],
        tags: [],
      };

      // Parse Windsurf-specific frontmatter
      if (parsed.data) {
        // Map activation modes to our frontmatter
        if (parsed.data.activation && typeof parsed.data.activation === "string") {
          const validModes = ["always", "manual", "model-decision", "glob"] as const;
          const activation = parsed.data.activation;
          const isValidMode = (mode: string): mode is (typeof validModes)[number] =>
            validModes.some((validMode) => validMode === mode);

          if (isValidMode(activation)) {
            frontmatter.windsurfActivationMode = activation;
          }
        }

        // Extract glob pattern from pattern field
        if (parsed.data.pattern && typeof parsed.data.pattern === "string") {
          frontmatter.globs = [parsed.data.pattern];
        }

        // Set description if not already set
        frontmatter.description = extractStringField(
          parsed.data,
          "description",
          filename.replace(/\.md$/, ""),
        );
      }

      // Determine output format based on file location
      if (filename === ".windsurf-rules") {
        frontmatter.windsurfOutputFormat = "single-file";
      } else {
        frontmatter.windsurfOutputFormat = "directory";
      }

      return {
        frontmatter,
        content: markdownContent.trim(),
        filename: filename.replace(/\.md$/, ""),
        filepath,
      };
    } catch {
      return null;
    }
  }
}
