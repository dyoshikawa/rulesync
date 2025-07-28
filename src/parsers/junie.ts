import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface JunieImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseJunieConfiguration(
  baseDir: string = process.cwd(),
): Promise<JunieImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Look for .junie/guidelines.md file
  const guidelinesPath = join(baseDir, ".junie", "guidelines.md");

  if (!(await fileExists(guidelinesPath))) {
    errors.push(".junie/guidelines.md file not found");
    return { rules, errors };
  }

  try {
    const content = await readFileContent(guidelinesPath);

    if (content.trim()) {
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["junie"],
        description: "Junie project guidelines",
        globs: ["**/*"],
      };

      rules.push({
        frontmatter,
        content: content.trim(),
        filename: "junie-guidelines",
        filepath: guidelinesPath,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse .junie/guidelines.md: ${errorMessage}`);
  }

  if (rules.length === 0) {
    errors.push("No valid Junie configuration found");
  }

  return { rules, errors };
}
