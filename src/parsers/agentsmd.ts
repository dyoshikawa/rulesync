import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface AgentsMdImportResult {
  rules: ParsedRule[];
  errors: string[];
}

/**
 * Parse AGENTS.md configuration files from a project directory
 *
 * AGENTS.md uses the same specification as Codex CLI:
 * 1. Project-level instructions: <project-root>/AGENTS.md (root rule)
 * 2. Memory files: <project-root>/.agents/memories/*.md (detail rules)
 *
 * For rulesync, we focus on project-level configuration that can be shared with teams.
 */
export async function parseAgentsMdConfiguration(
  baseDir: string = process.cwd(),
): Promise<AgentsMdImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Parse project-level AGENTS.md
  const projectAgentsPath = join(baseDir, "AGENTS.md");
  if (await fileExists(projectAgentsPath)) {
    try {
      const content = await readFileContent(projectAgentsPath);
      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true,
          targets: ["agentsmd"],
          description: "Project-level AGENTS.md instructions",
          globs: ["**/*"],
        };

        rules.push({
          frontmatter,
          content: content.trim(),
          filename: "project-instructions",
          filepath: projectAgentsPath,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse AGENTS.md: ${errorMessage}`);
    }
  }

  // Parse memory files from .agents/memories/
  const memoriesDir = join(baseDir, ".agents", "memories");
  if (await fileExists(memoriesDir)) {
    try {
      const { readdir, stat } = await import("node:fs/promises");
      const memoriesPath = memoriesDir;
      const memoriesStat = await stat(memoriesPath);

      if (memoriesStat.isDirectory()) {
        const files = await readdir(memoriesPath);

        for (const file of files) {
          if (file.endsWith(".md")) {
            const filePath = join(memoriesPath, file);

            try {
              const content = await readFileContent(filePath);
              if (content.trim()) {
                const filename = file.replace(/\.md$/, "");
                const frontmatter: RuleFrontmatter = {
                  root: false,
                  targets: ["agentsmd"],
                  description: `AGENTS.md memory: ${filename}`,
                  globs: ["**/*"],
                };

                rules.push({
                  frontmatter,
                  content: content.trim(),
                  filename,
                  filepath: filePath,
                });
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push(`Failed to parse memory file ${file}: ${errorMessage}`);
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read - not an error for optional memories
    }
  }

  // Parse directory-specific instruction files (following Codex CLI pattern)
  try {
    const { readdir } = await import("node:fs/promises");
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

        try {
          const content = await readFileContent(filePath);
          if (content.trim()) {
            const filename = file.replace(/\.md$/, "");
            const frontmatter: RuleFrontmatter = {
              root: false,
              targets: ["agentsmd"],
              description: `AGENTS.md instructions: ${filename}`,
              globs: ["**/*"],
            };

            rules.push({
              frontmatter,
              content: content.trim(),
              filename,
              filepath: filePath,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to parse ${file}: ${errorMessage}`);
        }
      }
    }

    // Look for subdirectories that might contain AGENTS.md files
    for (const file of files) {
      const filePath = join(baseDir, file);
      try {
        const { stat } = await import("node:fs/promises");
        const stats = await stat(filePath);

        if (stats.isDirectory() && !file.startsWith(".") && file !== "node_modules") {
          const subAgentsPath = join(filePath, "AGENTS.md");
          if (await fileExists(subAgentsPath)) {
            try {
              const content = await readFileContent(subAgentsPath);
              if (content.trim()) {
                const frontmatter: RuleFrontmatter = {
                  root: false,
                  targets: ["agentsmd"],
                  description: `Directory-specific AGENTS.md instructions: ${file}`,
                  globs: [`${file}/**/*`],
                };

                rules.push({
                  frontmatter,
                  content: content.trim(),
                  filename: `${file}-agents`,
                  filepath: subAgentsPath,
                });
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push(`Failed to parse ${subAgentsPath}: ${errorMessage}`);
            }
          }
        }
      } catch {
        // Ignore errors when checking if file is directory
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to scan directory for AGENTS.md files: ${errorMessage}`);
  }

  // If no rules found, add an informative error
  if (rules.length === 0) {
    errors.push(
      "No AGENTS.md configuration files found. Expected to find AGENTS.md in the project root or memory files in .agents/memories/.",
    );
  }

  return {
    rules,
    errors,
  };
}
