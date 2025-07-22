import { basename, join } from "node:path";
import matter from "gray-matter";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface AugmentImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseAugmentcodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Check for .augment/rules/ directory (new format only)
  const rulesDir = join(baseDir, ".augment", "rules");
  if (await fileExists(rulesDir)) {
    const rulesResult = await parseAugmentRules(rulesDir);
    rules.push(...rulesResult.rules);
    errors.push(...rulesResult.errors);
  } else {
    errors.push("No AugmentCode configuration found. Expected .augment/rules/ directory.");
  }

  return { rules, errors };
}

interface RulesParseResult {
  rules: ParsedRule[];
  errors: string[];
}

async function parseAugmentRules(rulesDir: string): Promise<RulesParseResult> {
  const rules: ParsedRule[] = [];
  const errors: string[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(rulesDir);

    for (const file of files) {
      if (file.endsWith(".md") || file.endsWith(".mdc")) {
        const filePath = join(rulesDir, file);
        try {
          const rawContent = await readFileContent(filePath);
          const parsed = matter(rawContent);

          // Parse frontmatter
          const frontmatterData = parsed.data;
          const ruleType = frontmatterData.type || "manual";
          const description = frontmatterData.description || "";
          const tags = Array.isArray(frontmatterData.tags) ? frontmatterData.tags : undefined;

          // Determine if this should be a root rule based on type
          const isRoot = ruleType === "always"; // Always rules become root rules

          const filename = basename(file, file.endsWith(".mdc") ? ".mdc" : ".md");
          const frontmatter: RuleFrontmatter = {
            root: isRoot,
            targets: ["augmentcode"],
            description: description,
            globs: ["**/*"], // AugmentCode doesn't use specific globs in the same way
            ...(tags && { tags }),
          };

          rules.push({
            frontmatter,
            content: parsed.content.trim(),
            filename: `augmentcode-${ruleType}-${filename}`,
            filepath: filePath,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to parse ${filePath}: ${errorMessage}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to read .augment/rules/ directory: ${errorMessage}`);
  }

  return { rules, errors };
}
