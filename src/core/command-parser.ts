import { basename } from "node:path";
import { CommandFrontmatterSchema, type ParsedCommand } from "../types/commands.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { findFiles, readFileContent } from "../utils/index.js";
import { logger } from "../utils/logger.js";

export async function parseCommandsFromDirectory(commandsDir: string): Promise<ParsedCommand[]> {
  const commandFiles = await findFiles(commandsDir, ".md");
  const commands: ParsedCommand[] = [];
  const errors: string[] = [];

  for (const filepath of commandFiles) {
    try {
      const command = await parseCommandFile(filepath);
      commands.push(command);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse command file ${filepath}: ${errorMessage}`);
    }
  }

  if (errors.length > 0) {
    logger.warn(`Command parsing errors:\n${errors.join("\n")}`);
  }

  return commands;
}

async function parseCommandFile(filepath: string): Promise<ParsedCommand> {
  const content = await readFileContent(filepath);
  const parsed = parseFrontmatter(content);

  try {
    const validatedData = CommandFrontmatterSchema.parse(parsed.data);
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
