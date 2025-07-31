import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface CodexImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
}

/**
 * Parse Codex CLI configuration files from a project directory
 *
 * Codex CLI uses a hierarchical system:
 * 1. Global user instructions: ~/.codex/instructions.md (not parsed by rulesync - user-specific)
 * 2. Project-level instructions: <project-root>/codex.md
 * 3. Directory-specific instructions: <current-working-directory>/codex.md
 *
 * For rulesync, we focus on project-level configuration that can be shared with teams.
 */
export async function parseCodexConfiguration(
  baseDir: string = process.cwd(),
): Promise<CodexImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;

  // Parse project-level codex.md
  const projectCodexPath = join(baseDir, "codex.md");
  if (await fileExists(projectCodexPath)) {
    try {
      const content = await readFileContent(projectCodexPath);
      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true,
          targets: ["codexcli"],
          description: "Project-level Codex CLI instructions",
          globs: ["**/*"],
        };

        rules.push({
          frontmatter,
          content: content.trim(),
          filename: "project-instructions",
          filepath: projectCodexPath,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse codex.md: ${errorMessage}`);
    }
  }

  // Parse directory-specific instruction files
  // Look for any .md files that might be directory-specific Codex instructions
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(baseDir);

    for (const file of files) {
      // Skip the main codex.md file as it's already processed above
      if (file === "codex.md") continue;

      // Look for files that might be Codex CLI instruction files
      // This could include subdirectory codex.md files or other .md instruction files
      if (
        file.endsWith(".md") &&
        (file.includes("codex") ||
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
              targets: ["codexcli"],
              description: `Codex CLI instructions: ${filename}`,
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

    // Look for subdirectories that might contain codex.md files
    for (const file of files) {
      const filePath = join(baseDir, file);
      try {
        const { stat } = await import("node:fs/promises");
        const stats = await stat(filePath);

        if (stats.isDirectory() && !file.startsWith(".") && file !== "node_modules") {
          const subCodexPath = join(filePath, "codex.md");
          if (await fileExists(subCodexPath)) {
            try {
              const content = await readFileContent(subCodexPath);
              if (content.trim()) {
                const frontmatter: RuleFrontmatter = {
                  root: false,
                  targets: ["codexcli"],
                  description: `Directory-specific Codex CLI instructions: ${file}`,
                  globs: [`${file}/**/*`],
                };

                rules.push({
                  frontmatter,
                  content: content.trim(),
                  filename: `${file}-codex`,
                  filepath: subCodexPath,
                });
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push(`Failed to parse ${subCodexPath}: ${errorMessage}`);
            }
          }
        }
      } catch {
        // Ignore errors when checking if file is directory
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to scan directory for Codex CLI files: ${errorMessage}`);
  }

  // Parse .codexignore file if it exists (community/unofficial support)
  const codexignorePath = join(baseDir, ".codexignore");
  if (await fileExists(codexignorePath)) {
    try {
      const content = await readFileContent(codexignorePath);
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      if (patterns.length > 0) {
        ignorePatterns = patterns;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse .codexignore: ${errorMessage}`);
    }
  }

  // If no rules found, add an informative error
  if (rules.length === 0) {
    errors.push(
      "No Codex CLI configuration files found. Expected to find codex.md in the project root or subdirectories.",
    );
  }

  return {
    rules,
    errors,
    ...(ignorePatterns && { ignorePatterns }),
  };
}
