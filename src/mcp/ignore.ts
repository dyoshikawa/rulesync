import { join } from "node:path";
import { z } from "zod/mini";
import { formatError } from "../utils/error.js";
import { ensureDir, readFileContent, removeFile, writeFileContent } from "../utils/file.js";

const maxIgnoreFileSizeBytes = 100 * 1024; // 100KB

/**
 * Tool to get the content of .rulesyncignore file
 */
async function getIgnoreFile(): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  const ignoreFilePath = join(process.cwd(), ".rulesyncignore");

  try {
    const content = await readFileContent(ignoreFilePath);

    return {
      relativePathFromCwd: ".rulesyncignore",
      content,
    };
  } catch (error) {
    throw new Error(`Failed to read .rulesyncignore file: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to create or update the .rulesyncignore file (upsert operation)
 */
async function putIgnoreFile({ content }: { content: string }): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  const ignoreFilePath = join(process.cwd(), ".rulesyncignore");

  // Check file size constraint
  const contentSizeBytes = Buffer.byteLength(content, "utf8");
  if (contentSizeBytes > maxIgnoreFileSizeBytes) {
    throw new Error(
      `Ignore file size ${contentSizeBytes} bytes exceeds maximum ${maxIgnoreFileSizeBytes} bytes (100KB)`,
    );
  }

  try {
    // Ensure parent directory exists (should be cwd, but just to be safe)
    await ensureDir(process.cwd());

    // Write the file
    await writeFileContent(ignoreFilePath, content);

    return {
      relativePathFromCwd: ".rulesyncignore",
      content,
    };
  } catch (error) {
    throw new Error(`Failed to write .rulesyncignore file: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to delete the .rulesyncignore file
 */
async function deleteIgnoreFile(): Promise<{
  relativePathFromCwd: string;
}> {
  const ignoreFilePath = join(process.cwd(), ".rulesyncignore");

  try {
    await removeFile(ignoreFilePath);

    return {
      relativePathFromCwd: ".rulesyncignore",
    };
  } catch (error) {
    throw new Error(`Failed to delete .rulesyncignore file: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Schema for ignore-related tool parameters
 */
export const ignoreToolSchemas = {
  getIgnoreFile: z.object({}),
  putIgnoreFile: z.object({
    content: z.string(),
  }),
  deleteIgnoreFile: z.object({}),
} as const;

/**
 * Tool definitions for ignore-related operations
 */
export const ignoreTools = {
  getIgnoreFile: {
    name: "getIgnoreFile",
    description: "Get the content of the .rulesyncignore file from the project root.",
    parameters: ignoreToolSchemas.getIgnoreFile,
    execute: async () => {
      const result = await getIgnoreFile();
      return JSON.stringify(result, null, 2);
    },
  },
  putIgnoreFile: {
    name: "putIgnoreFile",
    description:
      "Create or update the .rulesyncignore file (upsert operation). content parameter is required.",
    parameters: ignoreToolSchemas.putIgnoreFile,
    execute: async (args: { content: string }) => {
      const result = await putIgnoreFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteIgnoreFile: {
    name: "deleteIgnoreFile",
    description: "Delete the .rulesyncignore file from the project root.",
    parameters: ignoreToolSchemas.deleteIgnoreFile,
    execute: async () => {
      const result = await deleteIgnoreFile();
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
