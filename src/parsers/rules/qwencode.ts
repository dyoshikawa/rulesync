import { basename, join } from "node:path";
import type { RuleFrontmatter, ParsedRule } from "../../types/index.js";
import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for Qwen Code rule files
 */
export class QwenCodeRuleParser extends BaseRuleParser {
  getToolName() {
    return "qwencode" as const;
  }

  getRuleFilesPattern(): string[] {
    return ["QWEN.md", ".qwen/memories/*.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse main QWEN.md file
    await this.parseMainFile(baseDir, result);

    // Parse memory files
    await this.parseMemoryFiles(baseDir, result);

    return result;
  }

  private async parseMainFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const mainFilePath = resolvePath("QWEN.md", baseDir);
    if (!(await fileExists(mainFilePath))) {
      result.errors.push("QWEN.md file not found");
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const mainContent = await readFileContent(mainFilePath);
      const rule = this.parseMainFileContent(mainContent, mainFilePath);
      if (rule) {
        result.rules.push(rule);
      }
    }, "Failed to parse QWEN.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private parseMainFileContent(content: string, filepath: string): ParsedRule | null {
    // Extract the main content, excluding the reference table
    const lines = content.split("\n");
    let contentStartIndex = 0;

    // Skip the reference table if it exists
    if (lines.some((line) => line.includes("| Document | Description | File Patterns |"))) {
      const tableEndIndex = lines.findIndex(
        (line, index) =>
          index > 0 &&
          line.trim() === "" &&
          lines[index - 1]?.includes("|") &&
          !lines[index + 1]?.includes("|"),
      );
      if (tableEndIndex !== -1) {
        contentStartIndex = tableEndIndex + 1;
      }
    }

    const mainContent = lines.slice(contentStartIndex).join("\n").trim();

    if (!mainContent) {
      return null;
    }

    const frontmatter: RuleFrontmatter = {
      root: false,
      targets: ["qwencode"],
      description: "Main Qwen Code configuration",
      globs: ["**/*"],
    };

    return {
      frontmatter,
      content: mainContent,
      filename: "main",
      filepath,
    };
  }

  private async parseMemoryFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const memoryDir = resolvePath(".qwen/memories", baseDir);
    if (!(await fileExists(memoryDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(memoryDir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(memoryDir, file);
          const content = await readFileContent(filePath);

          if (content.trim()) {
            const filename = basename(file, ".md");
            const frontmatter: RuleFrontmatter = {
              root: false,
              targets: ["qwencode"],
              description: `Memory file: ${filename}`,
              globs: ["**/*"],
            };

            result.rules.push({
              frontmatter,
              content: content.trim(),
              filename: filename,
              filepath: filePath,
            });
          }
        }
      }
    }, "Failed to parse memory files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}