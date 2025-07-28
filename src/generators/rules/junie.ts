import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export async function generateJunieConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Separate root and non-root rules
  const rootRules = rules.filter((r) => r.frontmatter.root === true);
  const detailRules = rules.filter((r) => r.frontmatter.root === false);

  // Generate .junie/guidelines.md with combined content
  const guidelinesContent = generateGuidelinesMarkdown(rootRules, detailRules);
  const junieOutputDir = baseDir
    ? join(baseDir, config.outputPaths.junie)
    : config.outputPaths.junie;

  outputs.push({
    tool: "junie",
    filepath: join(junieOutputDir, ".junie", "guidelines.md"),
    content: guidelinesContent,
  });

  return outputs;
}

function generateGuidelinesMarkdown(rootRules: ParsedRule[], detailRules: ParsedRule[]): string {
  const lines: string[] = [];

  // Add all rules content (both root and detail) into single guidelines.md
  // Root rules come first
  if (rootRules.length > 0) {
    for (const rule of rootRules) {
      lines.push(rule.content);
      lines.push("");
    }
  }

  // Add detail rules
  if (detailRules.length > 0) {
    for (const rule of detailRules) {
      lines.push(rule.content);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
