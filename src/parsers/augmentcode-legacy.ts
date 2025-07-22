import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface AugmentcodeLegacyImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseAugmentcodeLegacyConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentcodeLegacyImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];

  // Check for .augment-guidelines file (legacy format only)
  const guidelinesPath = join(baseDir, ".augment-guidelines");
  if (await fileExists(guidelinesPath)) {
    const guidelinesResult = await parseAugmentGuidelines(guidelinesPath);
    if (guidelinesResult.rule) {
      rules.push(guidelinesResult.rule);
    }
    errors.push(...guidelinesResult.errors);
  } else {
    errors.push("No AugmentCode legacy configuration found. Expected .augment-guidelines file.");
  }

  return { rules, errors };
}

interface GuidelinesParseResult {
  rule: ParsedRule | null;
  errors: string[];
}

async function parseAugmentGuidelines(guidelinesPath: string): Promise<GuidelinesParseResult> {
  const errors: string[] = [];

  try {
    const content = await readFileContent(guidelinesPath);

    if (content.trim()) {
      const frontmatter: RuleFrontmatter = {
        root: true, // Legacy guidelines become root rules
        targets: ["augmentcode-legacy"],
        description: "Legacy AugmentCode guidelines",
        globs: ["**/*"],
      };

      const rule: ParsedRule = {
        frontmatter,
        content: content.trim(),
        filename: "augmentcode-legacy-guidelines",
        filepath: guidelinesPath,
      };

      return { rule, errors };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse .augment-guidelines: ${errorMessage}`);
  }

  return { rule: null, errors };
}
