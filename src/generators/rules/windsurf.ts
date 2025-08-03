import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateComplexRulesConfig } from "./shared-helpers.js";

export async function generateWindsurfConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateComplexRulesConfig(
    rules,
    config,
    {
      tool: "windsurf",
      fileExtension: ".md",
      ignoreFileName: ".codeiumignore",
      generateContent: generateWindsurfMarkdown,
      getOutputPath: (rule: ParsedRule, outputDir: string) => {
        return getWindsurfOutputPath(rule, outputDir);
      },
    },
    baseDir,
  );
}

function getWindsurfOutputPath(rule: ParsedRule, outputDir: string): string {
  // Based on the specification, we support two variants:
  // A. Single-File Variant: .windsurf-rules in project root
  // B. Directory Variant: .windsurf/rules/ directory with multiple .md files

  // Check if rule specifies a specific output format
  const outputFormat = rule.frontmatter.windsurfOutputFormat || "directory";

  if (outputFormat === "single-file") {
    // Single-file variant: output to .windsurf-rules
    return join(outputDir, ".windsurf-rules");
  } else {
    // Directory variant (recommended): output to .windsurf/rules/
    const rulesDir = join(outputDir, ".windsurf", "rules");
    return join(rulesDir, `${rule.filename}.md`);
  }
}

function generateWindsurfMarkdown(rule: ParsedRule): string {
  const lines: string[] = [];

  // Add YAML frontmatter if activation mode is specified
  const activationMode = rule.frontmatter.windsurfActivationMode;
  const globPattern = rule.frontmatter.globs?.[0];

  if (activationMode || globPattern) {
    lines.push("---");

    if (activationMode) {
      lines.push(`activation: ${activationMode}`);
    }

    if (globPattern && activationMode === "glob") {
      lines.push(`pattern: "${globPattern}"`);
    }

    lines.push("---");
    lines.push("");
  }

  // Add rule content
  lines.push(rule.content);

  return lines.join("\n");
}
