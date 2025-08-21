import { basename } from "node:path";
import type { ParsedSubagent } from "../types/subagents.js";
import { SubagentFrontmatterSchema } from "../types/subagents.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { findFiles, readFileContent } from "../utils/index.js";
import { logger } from "../utils/logger.js";

export async function parseSubagentsFromDirectory(directory: string): Promise<ParsedSubagent[]> {
  const subagentFiles = await findFiles(directory, ".md");
  const subagents: ParsedSubagent[] = [];
  const errors: string[] = [];

  for (const filepath of subagentFiles) {
    try {
      const subagent = await parseSubagentFile(filepath);
      subagents.push(subagent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse subagent file ${filepath}: ${errorMessage}`);
    }
  }

  if (errors.length > 0) {
    logger.warn(`Subagent parsing errors:\n${errors.join("\n")}`);
  }

  return subagents;
}

async function parseSubagentFile(filepath: string): Promise<ParsedSubagent> {
  const content = await readFileContent(filepath);
  const parsed = parseFrontmatter(content);

  try {
    const validatedData = SubagentFrontmatterSchema.parse(parsed.data);
    const filename = basename(filepath, ".md");

    return {
      frontmatter: {
        description: validatedData.description,
      },
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
