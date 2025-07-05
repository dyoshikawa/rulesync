import { basename } from "node:path";
import matter from "gray-matter";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
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

  // Validate frontmatter
  validateFrontmatter(parsed.data, filepath);

  // After validation, we can safely cast since validateFrontmatter ensures the shape
  const frontmatter = parsed.data as RuleFrontmatter;
  const filename = basename(filepath, ".md");

  return {
    frontmatter,
    content: parsed.content,
    filename,
    filepath,
  };
}

function validateFrontmatter(data: unknown, filepath: string): void {
  if (!data || typeof data !== "object") {
    if (!data) {
      throw new Error(
        `Missing frontmatter in ${filepath}: file must contain YAML frontmatter with required fields (root, targets, description, globs)`,
      );
    }
    throw new Error(`Invalid frontmatter in ${filepath}: frontmatter must be a valid YAML object`);
  }

  const obj = data as Record<string, unknown>;

  // Check if the object is completely empty
  if (Object.keys(obj).length === 0) {
    throw new Error(
      `Missing frontmatter in ${filepath}: file must contain YAML frontmatter with required fields (root, targets, description, globs)`,
    );
  }

  // Validate root
  if (obj.root === undefined) {
    throw new Error(`Missing required field "root" in ${filepath}: must be true or false`);
  }
  if (typeof obj.root !== "boolean") {
    throw new Error(
      `Invalid "root" field in ${filepath}: must be a boolean (true or false), got ${typeof obj.root}`,
    );
  }

  // Validate targets
  if (obj.targets === undefined) {
    throw new Error(
      `Missing required field "targets" in ${filepath}: must be an array like ["*"] or ["copilot", "cursor"]`,
    );
  }
  if (!Array.isArray(obj.targets)) {
    throw new Error(
      `Invalid "targets" field in ${filepath}: must be an array, got ${typeof obj.targets}`,
    );
  }

  const validTargets = ["copilot", "cursor", "cline", "claudecode", "roo", "geminicli", "*"];
  for (const target of obj.targets) {
    if (typeof target !== "string" || !validTargets.includes(target)) {
      throw new Error(
        `Invalid target "${target}" in ${filepath}: must be one of ${validTargets.join(", ")}`,
      );
    }
  }

  // Validate description
  if (obj.description === undefined) {
    throw new Error(
      `Missing required field "description" in ${filepath}: must be a descriptive string`,
    );
  }
  if (typeof obj.description !== "string") {
    throw new Error(
      `Invalid "description" field in ${filepath}: must be a string, got ${typeof obj.description}`,
    );
  }

  // Validate globs
  if (obj.globs === undefined) {
    throw new Error(
      `Missing required field "globs" in ${filepath}: must be an array of file patterns like ["**/*.ts"]`,
    );
  }
  if (!Array.isArray(obj.globs)) {
    throw new Error(
      `Invalid "globs" field in ${filepath}: must be an array, got ${typeof obj.globs}`,
    );
  }

  for (const glob of obj.globs) {
    if (typeof glob !== "string") {
      throw new Error(
        `Invalid glob pattern in ${filepath}: all globs must be strings, got ${typeof glob}`,
      );
    }
  }
}
