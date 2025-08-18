import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateIgnoreFile, resolveOutputDir } from "./shared-helpers.js";

export async function generateCodexConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // If no rules, return empty array
  if (rules.length === 0) {
    return outputs;
  }

  // Sort rules: root rules first, then detail rules
  const sortedRules = [...rules].sort((a, b) => {
    if (a.frontmatter.root === true && b.frontmatter.root !== true) return -1;
    if (a.frontmatter.root !== true && b.frontmatter.root === true) return 1;
    return 0;
  });

  // Generate concatenated content
  const concatenatedContent = generateConcatenatedCodexContent(sortedRules);

  // Only generate AGENTS.md file if we have content
  if (concatenatedContent.trim()) {
    const outputDir = resolveOutputDir(config, "codexcli", baseDir);
    const filepath = `${outputDir}/AGENTS.md`;

    outputs.push({
      tool: "codexcli",
      filepath,
      content: concatenatedContent,
    });
  }

  // Generate ignore file if .rulesyncignore exists
  const ignorePatterns = await loadIgnorePatterns(baseDir);
  if (ignorePatterns.patterns.length > 0) {
    const ignorePath = resolvePath(".codexignore", baseDir);
    const ignoreContent = generateIgnoreFile(ignorePatterns.patterns, "codexcli");

    outputs.push({
      tool: "codexcli",
      filepath: ignorePath,
      content: ignoreContent,
    });
  }

  return outputs;
}

function generateConcatenatedCodexContent(rules: ParsedRule[]): string {
  const sections: string[] = [];

  for (const rule of rules) {
    const content = rule.content.trim();

    if (!content) {
      continue; // Skip empty rules
    }

    // Add content directly - Codex CLI expects plain Markdown
    sections.push(content);
  }

  return sections.join("\n\n---\n\n");
}
