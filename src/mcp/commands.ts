import { basename, join } from "node:path";
import { z } from "zod/mini";
import {
  RulesyncCommand,
  type RulesyncCommandFrontmatter,
  RulesyncCommandFrontmatterSchema,
} from "../features/commands/rulesync-command.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  ensureDir,
  listDirectoryFiles,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { logger } from "../utils/logger.js";

const maxCommandSizeBytes = 1024 * 1024; // 1MB
const maxCommandsCount = 1000;

/**
 * Tool to list all commands from .rulesync/commands/*.md
 */
async function listCommands(): Promise<
  Array<{
    relativePathFromCwd: string;
    frontmatter: RulesyncCommandFrontmatter;
  }>
> {
  const commandsDir = join(process.cwd(), ".rulesync", "commands");

  try {
    const files = await listDirectoryFiles(commandsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    const commands = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          // Read the command file using RulesyncCommand
          const command = await RulesyncCommand.fromFile({
            relativeFilePath: file,
          });

          const frontmatter = command.getFrontmatter();

          return {
            relativePathFromCwd: join(".rulesync", "commands", file),
            frontmatter,
          };
        } catch (error) {
          logger.error(`Failed to read command file ${file}: ${formatError(error)}`);
          return null;
        }
      }),
    );

    // Filter out null values (failed reads)
    return commands.filter((command): command is NonNullable<typeof command> => command !== null);
  } catch (error) {
    logger.error(`Failed to read commands directory: ${formatError(error)}`);
    return [];
  }
}

/**
 * Tool to get detailed information about a specific command
 */
async function getCommand({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncCommandFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  try {
    const command = await RulesyncCommand.fromFile({
      relativeFilePath: filename,
    });

    return {
      relativePathFromCwd: join(".rulesync", "commands", filename),
      frontmatter: command.getFrontmatter(),
      body: command.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to read command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to create or update a command (upsert operation)
 */
async function putCommand({
  relativePathFromCwd,
  frontmatter,
  body,
}: {
  relativePathFromCwd: string;
  frontmatter: RulesyncCommandFrontmatter;
  body: string;
}): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncCommandFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  // Check file size constraint
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxCommandSizeBytes) {
    throw new Error(
      `Command size ${estimatedSize} bytes exceeds maximum ${maxCommandSizeBytes} bytes (1MB)`,
    );
  }

  try {
    // Check command count constraint
    const existingCommands = await listCommands();
    const isUpdate = existingCommands.some(
      (command) => command.relativePathFromCwd === join(".rulesync", "commands", filename),
    );

    if (!isUpdate && existingCommands.length >= maxCommandsCount) {
      throw new Error(`Maximum number of commands (${maxCommandsCount}) reached`);
    }

    // Create a new RulesyncCommand instance
    const fileContent = stringifyFrontmatter(body, frontmatter);
    const command = new RulesyncCommand({
      baseDir: process.cwd(),
      relativeDirPath: join(".rulesync", "commands"),
      relativeFilePath: filename,
      frontmatter,
      body,
      fileContent,
      validate: true,
    });

    // Ensure directory exists
    const commandsDir = join(process.cwd(), ".rulesync", "commands");
    await ensureDir(commandsDir);

    // Write the file
    await writeFileContent(command.getFilePath(), command.getFileContent());

    return {
      relativePathFromCwd: join(".rulesync", "commands", filename),
      frontmatter: command.getFrontmatter(),
      body: command.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to write command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to delete a command
 */
async function deleteCommand({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);
  const fullPath = join(process.cwd(), ".rulesync", "commands", filename);

  try {
    await removeFile(fullPath);

    return {
      relativePathFromCwd: join(".rulesync", "commands", filename),
    };
  } catch (error) {
    throw new Error(`Failed to delete command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Schema for command-related tool parameters
 */
export const commandToolSchemas = {
  listCommands: z.object({}),
  getCommand: z.object({
    relativePathFromCwd: z.string(),
  }),
  putCommand: z.object({
    relativePathFromCwd: z.string(),
    frontmatter: RulesyncCommandFrontmatterSchema,
    body: z.string(),
  }),
  deleteCommand: z.object({
    relativePathFromCwd: z.string(),
  }),
} as const;

/**
 * Tool definitions for command-related operations
 */
export const commandTools = {
  listCommands: {
    name: "listCommands",
    description: `List all commands from ${join(".rulesync", "commands", "*.md")} with their frontmatter.`,
    parameters: commandToolSchemas.listCommands,
    execute: async () => {
      const commands = await listCommands();
      const output = { commands };
      return JSON.stringify(output, null, 2);
    },
  },
  getCommand: {
    name: "getCommand",
    description:
      "Get detailed information about a specific command. relativePathFromCwd parameter is required.",
    parameters: commandToolSchemas.getCommand,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await getCommand({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
  putCommand: {
    name: "putCommand",
    description:
      "Create or update a command (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: commandToolSchemas.putCommand,
    execute: async (args: {
      relativePathFromCwd: string;
      frontmatter: RulesyncCommandFrontmatter;
      body: string;
    }) => {
      const result = await putCommand({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
      });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteCommand: {
    name: "deleteCommand",
    description: "Delete a command file. relativePathFromCwd parameter is required.",
    parameters: commandToolSchemas.deleteCommand,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await deleteCommand({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
