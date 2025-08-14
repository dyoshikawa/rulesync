import { basename } from "node:path";
import matter from "gray-matter";
import { CommandFrontmatterSchema, type ParsedCommand } from "../types/commands.js";
import { findFiles, readFileContent } from "../utils/index.js";

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
    console.warn(`⚠️  Command parsing errors:\n${errors.join("\n")}`);
  }

  return commands;
}

async function parseCommandFile(filepath: string): Promise<ParsedCommand> {
  const content = await readFileContent(filepath);
  const parsed = matter(content);

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
