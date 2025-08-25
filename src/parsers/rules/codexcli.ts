import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../../types/index.js";
import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for OpenAI Codex CLI rule files (hierarchical AGENTS.md files)
 */
export class CodexCLIRuleParser extends BaseRuleParser {
  getToolName() {
    return "codexcli" as const;
  }

  getRuleFilesPattern(): string[] {
    return ["AGENTS.md", "**/AGENTS.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse project-level AGENTS.md
    await this.parseProjectAgentsFile(baseDir, result);

    // Parse directory-specific AGENTS.md files
    await this.parseSubdirectoryAgentsFiles(baseDir, result);

    // Parse other instruction files
    await this.parseOtherInstructionFiles(baseDir, result);

    // If no rules found, add an informative error
    if (result.rules.length === 0) {
      result.errors.push(
        "No Codex CLI configuration files found. Expected to find AGENTS.md in the project root or subdirectories.",
      );
    }

    return result;
  }

  private async parseProjectAgentsFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const projectCodexPath = join(baseDir, "AGENTS.md");
    if (!(await fileExists(projectCodexPath))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(projectCodexPath);
      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true,
          targets: ["codexcli"],
          description: "Project-level Codex CLI instructions",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "project-instructions",
          filepath: projectCodexPath,
        });
      }
    }, "Failed to parse AGENTS.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseSubdirectoryAgentsFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const parseResult = await safeAsyncOperation(async () => {
      const { readdir, stat } = await import("node:fs/promises");
      const files = await readdir(baseDir);

      // Look for subdirectories that might contain AGENTS.md files
      for (const file of files) {
        if (file.startsWith(".") || file === "node_modules") {
          continue;
        }

        const filePath = join(baseDir, file);
        
        try {
          const stats = await stat(filePath);
          if (stats.isDirectory()) {
            const subCodexPath = join(filePath, "AGENTS.md");
            if (await fileExists(subCodexPath)) {
              const subParseResult = await safeAsyncOperation(async () => {
                const content = await readFileContent(subCodexPath);
                if (content.trim()) {
                  const frontmatter: RuleFrontmatter = {
                    root: false,
                    targets: ["codexcli"],
                    description: `Directory-specific Codex CLI instructions: ${file}`,
                    globs: [`${file}/**/*`],
                  };

                  result.rules.push({
                    frontmatter,
                    content: content.trim(),
                    filename: `${file}-agents`,
                    filepath: subCodexPath,
                  });
                }
              }, `Failed to parse ${subCodexPath}`);

              if (!subParseResult.success) {
                result.errors.push(subParseResult.error);
              }
            }
          }
        } catch {
          // Ignore errors when checking if file is directory
        }
      }
    }, "Failed to scan directory for Codex CLI files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseOtherInstructionFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(baseDir);

      for (const file of files) {
        // Skip the main AGENTS.md file as it's already processed above
        if (file === "AGENTS.md") continue;

        // Look for files that might be Codex CLI instruction files
        if (
          file.endsWith(".md") &&
          (file.includes("codex") ||
            file.includes("instructions") ||
            file.includes("guidelines") ||
            file.includes("rules"))
        ) {
          const filePath = join(baseDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const content = await readFileContent(filePath);
            if (content.trim()) {
              const filename = file.replace(/\.md$/, "");
              const frontmatter: RuleFrontmatter = {
                root: false,
                targets: ["codexcli"],
                description: `Codex CLI instructions: ${filename}`,
                globs: ["**/*"],
              };

              result.rules.push({
                frontmatter,
                content: content.trim(),
                filename,
                filepath: filePath,
              });
            }
          }, `Failed to parse ${file}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse other instruction files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}
