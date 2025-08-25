import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../../types/index.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { extractStringField, parseFrontmatter } from "../../utils/frontmatter.js";

/**
 * Parse a single command file (markdown format)
 */
export async function parseCommandFile(
  filePath: string,
  tool: ToolTarget,
  defaultDescription?: string,
): Promise<ParsedRule | null> {
  try {
    const content = await readFileContent(filePath);
    if (!content.trim()) {
      return null;
    }

    const filename = basename(filePath, ".md");
    let frontmatter: RuleFrontmatter;
    let ruleContent: string;

    try {
      // Try to parse frontmatter
      const parsed = parseFrontmatter(content);
      ruleContent = parsed.content;
      frontmatter = {
        root: false,
        targets: [tool],
        description: extractStringField(
          parsed.data,
          "description",
          defaultDescription || `Command: ${filename}`,
        ),
        globs: ["**/*"],
      };
    } catch {
      // If frontmatter parsing fails, treat as plain content
      ruleContent = content.trim();
      frontmatter = {
        root: false,
        targets: [tool],
        description: defaultDescription || `Command: ${filename}`,
        globs: ["**/*"],
      };
    }

    if (!ruleContent) {
      return null;
    }

    return {
      frontmatter,
      content: ruleContent,
      filename,
      filepath: filePath,
      type: "command",
    } satisfies ParsedRule;
  } catch {
    // Return null if file cannot be parsed
    return null;
  }
}

/**
 * Parse commands from a directory (markdown files)
 */
export async function parseCommandsFromDirectory(
  commandsDir: string,
  tool: ToolTarget,
  fileExtension: string = ".md",
  descriptionPrefix: string = "Command",
): Promise<ParsedRule[]> {
  const commands: ParsedRule[] = [];

  if (!(await fileExists(commandsDir))) {
    return commands;
  }

  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(commandsDir);

    for (const file of files) {
      if (file.endsWith(fileExtension)) {
        const filePath = join(commandsDir, file);
        const filename = basename(file, fileExtension);

        const command = await parseCommandFile(filePath, tool, `${descriptionPrefix}: ${filename}`);

        if (command) {
          // Override filename to ensure correct extension stripping
          command.filename = filename;
          commands.push(command);
        }
      }
    }
  } catch {
    // Commands files are optional, so we don't throw errors
  }

  return commands;
}
