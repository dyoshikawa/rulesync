import { basename, join } from "node:path";
import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for OpenCode rule files (AGENTS.md and memory files)
 */
export class OpenCodeRuleParser extends BaseRuleParser {
  getToolName() {
    return "opencode" as const;
  }

  getRuleFilesPattern(): string {
    return "AGENTS.md, .opencode/memories/*.md";
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse AGENTS.md file
    await this.parseAgentsFile(baseDir, result);

    // Parse memory files from .opencode/memories directory
    await this.parseMemoryFiles(baseDir, result);

    return result;
  }

  private async parseAgentsFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const agentsPath = resolvePath("AGENTS.md", baseDir);
    if (!(await fileExists(agentsPath))) {
      // Not an error - AGENTS.md is optional
      return;
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
  }

  private async parseMemoryFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const memoryDir = join(baseDir, ".opencode", "memories");
    if (!(await fileExists(memoryDir))) {
      // Not an error - memory directory is optional
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(memoryDir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(memoryDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const content = await readFileContent(filePath);

            if (!content.trim()) {
              return;
            }

            const filename = basename(file, ".md");
            const frontmatter: RuleFrontmatter = {
              root: false,
              targets: ["opencode"],
              description: `Memory file: ${filename}`,
              globs: ["**/*"],
            };

            result.rules.push({
              frontmatter,
              content: content.trim(),
              filename,
              filepath: filePath,
            });
          }, `Failed to parse memory file ${file}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse memory files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
