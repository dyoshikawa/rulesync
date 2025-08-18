import { XMLBuilder } from "fast-xml-parser";
import type { ParsedRule } from "../types/index.js";

export interface DocumentGeneratorConfig {
  memorySubDir: string;
  fallbackTitle: string;
}

/**
 * Generates root markdown with XML document references for memory-based tools
 * Consolidates duplicate logic between Gemini CLI and OpenCode generators
 */
export function generateRootMarkdownWithXmlDocs(
  rootRule: ParsedRule | undefined,
  memoryRules: ParsedRule[],
  config: DocumentGeneratorConfig,
): string {
  const lines: string[] = [];

  // Start with CLAUDE.md style introduction if memory files exist
  if (memoryRules.length > 0) {
    lines.push(
      "Please also reference the following documents as needed. In this case, `@` stands for the project root directory.",
    );
    lines.push("");

    // Build XML structure using fast-xml-parser XMLBuilder
    const documentsData = {
      Documents: {
        Document: memoryRules.map((rule) => {
          const relativePath = `@${config.memorySubDir}/${rule.filename}.md`;
          const document: Record<string, string> = {
            Path: relativePath,
            Description: rule.frontmatter.description,
          };

          // Only include FilePatterns if globs exist
          if (rule.frontmatter.globs.length > 0) {
            document.FilePatterns = rule.frontmatter.globs.join(", ");
          }

          return document;
        }),
      },
    };

    const builder = new XMLBuilder({
      format: true,
      ignoreAttributes: false,
      suppressEmptyNode: false,
    });

    const xmlContent = builder.build(documentsData);
    lines.push(xmlContent);
    lines.push("");
    lines.push("");
  }

  // Add root rule content if available
  if (rootRule) {
    lines.push(rootRule.content.trim());
  } else if (memoryRules.length === 0) {
    // Fallback if no rules are provided
    lines.push(`# ${config.fallbackTitle}`);
    lines.push("");
    lines.push("No configuration rules have been defined yet.");
  }

  return lines.join("\n");
}
