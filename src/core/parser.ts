import { basename } from "node:path";
import matter from "gray-matter";
import { type ParsedRule, RuleFrontmatterSchema } from "../types/index.js";
import { loadIgnorePatterns } from "../utils/ignore.js";
import { findFiles, readFileContent } from "../utils/index.js";

export async function parseRulesFromDirectory(aiRulesDir: string): Promise<ParsedRule[]> {
  const ignorePatterns = await loadIgnorePatterns();
  const ruleFiles = await findFiles(aiRulesDir, ".md", ignorePatterns.patterns);
  const rules: ParsedRule[] = [];
  const errors: string[] = [];

  if (ignorePatterns.patterns.length > 0) {
    console.log(`Loaded ${ignorePatterns.patterns.length} ignore patterns from .rulesyncignore`);
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
  const parsed = matter(content);

  // Validate frontmatter using zod schema
  try {
    const frontmatter = RuleFrontmatterSchema.parse(parsed.data);
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
