import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";

export interface ImportOptions {
  ignoreErrors?: boolean;
}

export async function importWindsurfRules(
  sourceDir: string,
  options: ImportOptions = {},
): Promise<ParsedRule[]> {
  const results: ParsedRule[] = [];

  try {
    // Try to parse single-file variant first: .windsurf-rules
    const singleFilePath = join(sourceDir, ".windsurf-rules");
    try {
      const content = await readFile(singleFilePath, "utf-8");
      const parsed = parseWindsurfRule(content, ".windsurf-rules", singleFilePath);
      if (parsed) {
        results.push(parsed);
      }
    } catch {
      // File doesn't exist, that's OK
    }

    // Try to parse directory variant: .windsurf/rules/
    const rulesDir = join(sourceDir, ".windsurf", "rules");
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(rulesDir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(rulesDir, file);
          const content = await readFile(filePath, "utf-8");
          const parsed = parseWindsurfRule(content, file, filePath);
          if (parsed) {
            results.push(parsed);
          }
        }
      }
    } catch {
      // Directory doesn't exist, that's OK
    }

    return results;
  } catch (error) {
    if (options.ignoreErrors) {
      console.warn(`Warning: Failed to import Windsurf rules from ${sourceDir}:`, error);
      return results;
    }
    throw error;
  }
}

function parseWindsurfRule(content: string, filename: string, filepath: string): ParsedRule | null {
  try {
    const parsed = matter(content);
    const yamlFrontmatter = parsed.data;
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
    if (yamlFrontmatter) {
      // Map activation modes to our frontmatter
      if (yamlFrontmatter.activation) {
        frontmatter.windsurfActivationMode = yamlFrontmatter.activation;
      }

      // Extract glob pattern from pattern field
      if (yamlFrontmatter.pattern) {
        frontmatter.globs = [yamlFrontmatter.pattern];
      }

      // Set description if not already set
      if (yamlFrontmatter.description) {
        frontmatter.description = yamlFrontmatter.description;
      }
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
  } catch (error) {
    console.warn(`Warning: Failed to parse Windsurf rule file ${filename}:`, error);
    return null;
  }
}
