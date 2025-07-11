import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";

export async function generateRooConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Generate rule files
  for (const rule of rules) {
    const content = generateRooMarkdown(rule);
    const outputDir = baseDir ? join(baseDir, config.outputPaths.roo) : config.outputPaths.roo;
    const filepath = join(outputDir, `${rule.filename}.md`);

    outputs.push({
      tool: "roo",
      filepath,
      content,
    });
  }

  // Generate .rooignore if .rulesyncignore exists
  const ignorePatterns = await loadIgnorePatterns(baseDir);
  if (ignorePatterns.patterns.length > 0) {
    const rooIgnorePath = baseDir ? join(baseDir, ".rooignore") : ".rooignore";

    const rooIgnoreContent = generateRooIgnore(ignorePatterns.patterns);

    outputs.push({
      tool: "roo",
      filepath: rooIgnorePath,
      content: rooIgnoreContent,
    });
  }

  return outputs;
}

function generateRooMarkdown(rule: ParsedRule): string {
  return rule.content.trim();
}

function generateRooIgnore(patterns: string[]): string {
  const lines: string[] = [
    "# Generated by rulesync from .rulesyncignore",
    "# This file is automatically generated. Do not edit manually.",
    "",
    ...patterns,
  ];

  return lines.join("\n");
}
