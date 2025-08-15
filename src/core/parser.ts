import { basename } from "node:path";
import { type ParsedRule, type RuleFrontmatter, RuleFrontmatterSchema } from "../types/index.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { filterIgnoredFiles, loadIgnorePatterns } from "../utils/ignore.js";
import { findRuleFiles, readFileContent } from "../utils/index.js";
import { logger } from "../utils/logger.js";

export async function parseRulesFromDirectory(aiRulesDir: string): Promise<ParsedRule[]> {
  const ignorePatterns = await loadIgnorePatterns();
  const allRuleFiles = await findRuleFiles(aiRulesDir);
  const ruleFiles = filterIgnoredFiles(allRuleFiles, ignorePatterns.patterns);
  const rules: ParsedRule[] = [];
  const errors: string[] = [];

  if (ignorePatterns.patterns.length > 0) {
    logger.info(`Loaded ${ignorePatterns.patterns.length} ignore patterns from .rulesyncignore`);
  }

  for (const filepath of ruleFiles) {
    try {
      const rule = await parseRuleFile(filepath);
      rules.push(rule);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse rule file ${filepath}: ${errorMessage}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors found:\n${errors.join("\n")}`);
  }

  // Check for multiple root rules
  const rootRules = rules.filter((rule) => rule.frontmatter.root);
  if (rootRules.length > 1) {
    const rootRuleFiles = rootRules.map((rule) => rule.filepath).join(", ");
    throw new Error(
      `Multiple root rules found: ${rootRuleFiles}. Only one rule can have root: true.`,
    );
  }

  return rules;
}

export async function parseRuleFile(filepath: string): Promise<ParsedRule> {
  const content = await readFileContent(filepath);
  const parsed = parseFrontmatter(content);

  // Validate frontmatter using zod schema
  try {
    const validatedData = RuleFrontmatterSchema.parse(parsed.data);

    // Apply default values for optional fields
    const frontmatter: RuleFrontmatter = {
      root: validatedData.root ?? false,
      targets: validatedData.targets ?? ["*"],
      description: validatedData.description ?? "",
      globs: validatedData.globs ?? [],
      ...(validatedData.cursorRuleType !== undefined && {
        cursorRuleType: validatedData.cursorRuleType,
      }),
      ...(validatedData.windsurfActivationMode !== undefined && {
        windsurfActivationMode: validatedData.windsurfActivationMode,
      }),
      ...(validatedData.windsurfOutputFormat !== undefined && {
        windsurfOutputFormat: validatedData.windsurfOutputFormat,
      }),
      ...(validatedData.tags !== undefined && { tags: validatedData.tags }),
    };

    const filename = basename(filepath, ".md");

    return {
      frontmatter,
      content: parsed.content,
      filename,
      filepath,
    };
  } catch (error) {
    throw new Error(
      `Invalid frontmatter in ${filepath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
