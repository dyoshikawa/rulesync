import { join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import { fileExists, readFileContent } from "../utils/index.js";
import { addError, addRule, createParseResult, safeReadFile } from "../utils/parser-helpers.js";

export interface AugmentcodeLegacyImportResult {
  rules: ParsedRule[];
  errors: string[];
}

export async function parseAugmentcodeLegacyConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentcodeLegacyImportResult> {
  const result = createParseResult();

  // Check for .augment-guidelines file (legacy format only)
  const guidelinesPath = join(baseDir, ".augment-guidelines");
  if (await fileExists(guidelinesPath)) {
    const guidelinesResult = await parseAugmentGuidelines(guidelinesPath);
    if (guidelinesResult.rule) {
      addRule(result, guidelinesResult.rule);
    }
    result.errors.push(...guidelinesResult.errors);
  } else {
    addError(
      result,
      "No AugmentCode legacy configuration found. Expected .augment-guidelines file.",
    );
  }

  return { rules: result.rules || [], errors: result.errors };
}

interface GuidelinesParseResult {
  rule: ParsedRule | null;
  errors: string[];
}

async function parseAugmentGuidelines(guidelinesPath: string): Promise<GuidelinesParseResult> {
  const parseResult = await safeReadFile(async () => {
    const content = await readFileContent(guidelinesPath);

    if (content.trim()) {
      const frontmatter: RuleFrontmatter = {
        root: true, // Legacy guidelines become root rules
        targets: ["augmentcode-legacy"],
        description: "Legacy AugmentCode guidelines",
        globs: ["**/*"],
      };

      return {
        frontmatter,
        content: content.trim(),
        filename: "augmentcode-legacy-guidelines",
        filepath: guidelinesPath,
      };
    }
    return null;
  }, "Failed to parse .augment-guidelines");

  if (parseResult.success) {
    return { rule: parseResult.result || null, errors: [] };
  } else {
    return { rule: null, errors: [parseResult.error || "Unknown error"] };
  }
}
