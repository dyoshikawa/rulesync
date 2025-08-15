import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter, ToolTarget } from "../types/index.js";
import { extractArrayField, extractStringField, parseFrontmatter } from "../utils/frontmatter.js";
import { fileExists, readFileContent } from "../utils/index.js";
import {
  addError,
  addRule,
  addRules,
  createParseResult,
  safeReadFile,
} from "../utils/parser-helpers.js";

export interface AugmentImportResult {
  rules: ParsedRule[];
  errors: string[];
}

interface AugmentcodeParserConfig {
  rulesDir?: string;
  legacyFilePath?: string;
  targetName: ToolTarget;
  filenamePrefix: string;
}

export async function parseAugmentcodeConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentImportResult> {
  return parseUnifiedAugmentcode(baseDir, {
    rulesDir: ".augment/rules",
    targetName: "augmentcode",
    filenamePrefix: "augmentcode",
  });
}

export async function parseAugmentcodeLegacyConfiguration(
  baseDir: string = process.cwd(),
): Promise<AugmentImportResult> {
  return parseUnifiedAugmentcode(baseDir, {
    legacyFilePath: ".augment-guidelines",
    targetName: "augmentcode-legacy",
    filenamePrefix: "augmentcode-legacy",
  });
}

async function parseUnifiedAugmentcode(
  baseDir: string,
  config: AugmentcodeParserConfig,
): Promise<AugmentImportResult> {
  const result = createParseResult();

  // Try modern format first if configured
  if (config.rulesDir) {
    const rulesDir = join(baseDir, config.rulesDir);
    if (await fileExists(rulesDir)) {
      const rulesResult = await parseAugmentRules(rulesDir, config);
      addRules(result, rulesResult.rules);
      result.errors.push(...rulesResult.errors);
    } else {
      addError(
        result,
        `No AugmentCode configuration found. Expected ${config.rulesDir} directory.`,
      );
    }
  }

  // Try legacy format if configured
  if (config.legacyFilePath) {
    const legacyPath = join(baseDir, config.legacyFilePath);
    if (await fileExists(legacyPath)) {
      const legacyResult = await parseAugmentGuidelines(legacyPath, config);
      if (legacyResult.rule) {
        addRule(result, legacyResult.rule);
      }
      result.errors.push(...legacyResult.errors);
    } else {
      addError(
        result,
        `No AugmentCode legacy configuration found. Expected ${config.legacyFilePath} file.`,
      );
    }
  }

  return { rules: result.rules || [], errors: result.errors };
}

interface RulesParseResult {
  rules: ParsedRule[];
  errors: string[];
}

async function parseAugmentRules(
  rulesDir: string,
  config: AugmentcodeParserConfig,
): Promise<RulesParseResult> {
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
          const parsed = parseFrontmatter(rawContent);

          // Parse frontmatter
          const ruleType = extractStringField(parsed.data, "type", "manual");
          const description = extractStringField(parsed.data, "description", "");
          const tags = extractArrayField(parsed.data, "tags");

          // Determine if this should be a root rule based on type
          const isRoot = ruleType === "always"; // Always rules become root rules

          const filename = basename(file, file.endsWith(".mdc") ? ".mdc" : ".md");
          const frontmatter: RuleFrontmatter = {
            root: isRoot,
            targets: [config.targetName],
            description: description,
            globs: ["**/*"], // AugmentCode doesn't use specific globs in the same way
            ...(tags.length > 0 && { tags }),
          };

          rules.push({
            frontmatter,
            content: parsed.content.trim(),
            filename: `${config.filenamePrefix}-${ruleType}-${filename}`,
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
    errors.push(`Failed to read ${config.rulesDir || rulesDir} directory: ${errorMessage}`);
  }

  return { rules, errors };
}

interface GuidelinesParseResult {
  rule: ParsedRule | null;
  errors: string[];
}

async function parseAugmentGuidelines(
  guidelinesPath: string,
  config: AugmentcodeParserConfig,
): Promise<GuidelinesParseResult> {
  const parseResult = await safeReadFile(
    async () => {
      const content = await readFileContent(guidelinesPath);

      if (content.trim()) {
        const frontmatter: RuleFrontmatter = {
          root: true, // Legacy guidelines become root rules
          targets: [config.targetName],
          description: "Legacy AugmentCode guidelines",
          globs: ["**/*"],
        };

        return {
          frontmatter,
          content: content.trim(),
          filename: `${config.filenamePrefix}-guidelines`,
          filepath: guidelinesPath,
        };
      }
      return null;
    },
    `Failed to parse ${config.legacyFilePath || guidelinesPath}`,
  );

  if (parseResult.success) {
    return { rule: parseResult.result || null, errors: [] };
  } else {
    return { rule: null, errors: [parseResult.error || "Unknown error"] };
  }
}
