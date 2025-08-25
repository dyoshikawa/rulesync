import { join } from "node:path";
import type { RuleFrontmatter } from "../../types/index.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for AGENTS.md files with full hierarchical support
 */
export class AgentsMdRuleParser extends BaseRuleParser {
  getToolName() {
    return "agentsmd" as const;
  }

  getRuleFilesPattern(): string[] {
    return ["AGENTS.md", ".agents/memories/*.md", "**/AGENTS.md"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse project-level AGENTS.md
    await this.parseProjectAgentsFile(baseDir, result);

    // Parse memory files from .agents/memories/
    await this.parseMemoryFiles(baseDir, result);

    // Parse directory-specific AGENTS.md files and other instruction files
    await this.parseDirectorySpecificFiles(baseDir, result);

    // If no rules found, add an informative error
    if (result.rules.length === 0) {
      result.errors.push(
        "No AGENTS.md configuration files found. Expected to find AGENTS.md in the project root or memory files in .agents/memories/.",
      );
    }

    return result;
  }

  private async parseProjectAgentsFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const projectAgentsPath = join(baseDir, "AGENTS.md");
    if (!(await fileExists(projectAgentsPath))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const content = await readFileContent(projectAgentsPath);
      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true,
          targets: ["agentsmd"],
          description: "Project-level AGENTS.md instructions",
          globs: ["**/*"],
        };

        result.rules.push({
          frontmatter,
          content: content.trim(),
          filename: "project-instructions",
          filepath: projectAgentsPath,
        });
      }
    }, "Failed to parse AGENTS.md");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseMemoryFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const memoriesDir = join(baseDir, ".agents", "memories");
    if (!(await fileExists(memoriesDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir, stat } = await import("node:fs/promises");
      const memoriesStat = await stat(memoriesDir);

      if (memoriesStat.isDirectory()) {
        const files = await readdir(memoriesDir);

        for (const file of files) {
          if (file.endsWith(".md")) {
            const filePath = join(memoriesDir, file);
            const fileResult = await safeAsyncOperation(async () => {
              const content = await readFileContent(filePath);
              if (content.trim()) {
                const filename = file.replace(/\.md$/, "");
                const frontmatter: RuleFrontmatter = {
                  root: false,
                  targets: ["agentsmd"],
                  description: `AGENTS.md memory: ${filename}`,
                  globs: ["**/*"],
                };

                result.rules.push({
                  frontmatter,
                  content: content.trim(),
                  filename,
                  filepath: filePath,
                });
              }
            }, `Failed to parse memory file ${file}`);

            if (!fileResult.success) {
              result.errors.push(fileResult.error);
            }
          }
        }
      }
    }, "Failed to parse memory files");

    if (!parseResult.success) {
      // Directory doesn't exist or can't be read - not an error for optional memories
    }
  }

  private async parseDirectorySpecificFiles(
    baseDir: string,
    result: RuleParseResult,
  ): Promise<void> {
    const parseResult = await safeAsyncOperation(async () => {
      const { readdir, stat } = await import("node:fs/promises");
      const files = await readdir(baseDir);

      for (const file of files) {
        // Skip the main AGENTS.md file as it's already processed above
        if (file === "AGENTS.md") continue;

        // Look for files that might be AGENTS.md instruction files
        if (
          file.endsWith(".md") &&
          (file.includes("agents") ||
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
                targets: ["agentsmd"],
                description: `AGENTS.md instructions: ${filename}`,
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

      // Look for subdirectories that might contain AGENTS.md files
      for (const file of files) {
        if (file.startsWith(".") || file === "node_modules") {
          continue;
        }

        const filePath = join(baseDir, file);
        try {
          const stats = await stat(filePath);

          if (stats.isDirectory()) {
            const subAgentsPath = join(filePath, "AGENTS.md");
            if (await fileExists(subAgentsPath)) {
              const subParseResult = await safeAsyncOperation(async () => {
                const content = await readFileContent(subAgentsPath);
                if (content.trim()) {
                  const frontmatter: RuleFrontmatter = {
                    root: false,
                    targets: ["agentsmd"],
                    description: `Directory-specific AGENTS.md instructions: ${file}`,
                    globs: [`${file}/**/*`],
                  };

                  result.rules.push({
                    frontmatter,
                    content: content.trim(),
                    filename: `${file}-agents`,
                    filepath: subAgentsPath,
                  });
                }
              }, `Failed to parse ${subAgentsPath}`);

              if (!subParseResult.success) {
                result.errors.push(subParseResult.error);
              }
            }
          }
        } catch {
          // Ignore errors when checking if file is directory
        }
      }
    }, "Failed to scan directory for AGENTS.md files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }
}

/**
 * Create an AGENTS.md rule parser for a specific tool
 */
export function createAgentsMdRuleParser(tool: ToolTarget, description?: string): BaseRuleParser {
  // For simple tools, return the simple AgentsMd parser
  class SimpleAgentsMdRuleParser extends BaseRuleParser {
    getToolName() {
      return tool;
    }

    getRuleFilesPattern(): string {
      return "AGENTS.md";
    }

    async parseRules(baseDir: string): Promise<RuleParseResult> {
      const result: RuleParseResult = {
        rules: [],
        errors: [],
      };

      const agentsPath = join(baseDir, "AGENTS.md");
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
          targets: [tool],
          description: description || "AGENTS.md configuration",
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

  return new SimpleAgentsMdRuleParser();
}
