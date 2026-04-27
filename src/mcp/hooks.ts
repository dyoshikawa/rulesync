import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { formatError } from "../utils/error.js";
import { ensureDir, removeFile, writeFileContent } from "../utils/file.js";

const maxHooksSizeBytes = 1024 * 1024; // 1MB

/**
 * Tool to get the hooks configuration file
 */
async function getHooksFile(): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  try {
    const rulesyncHooks = await RulesyncHooks.fromFile({
      validate: true,
    });

    const relativePathFromCwd = join(
      rulesyncHooks.getRelativeDirPath(),
      rulesyncHooks.getRelativeFilePath(),
    );

    return {
      relativePathFromCwd,
      content: rulesyncHooks.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to read hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to create or update the hooks configuration file (upsert operation)
 */
async function putHooksFile({ content }: { content: string }): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  // Check file size constraint
  if (content.length > maxHooksSizeBytes) {
    throw new Error(
      `Hooks file size ${content.length} bytes exceeds maximum ${maxHooksSizeBytes} bytes (1MB) for ${RULESYNC_HOOKS_RELATIVE_FILE_PATH}`,
    );
  }

  // Validate JSON format
  try {
    JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON format in hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  try {
    const outputRoot = process.cwd();
    const paths = RulesyncHooks.getSettablePaths();

    const relativeDirPath = paths.relativeDirPath;
    const relativeFilePath = paths.relativeFilePath;
    const fullPath = join(outputRoot, relativeDirPath, relativeFilePath);

    // Create a RulesyncHooks instance to validate the content
    const rulesyncHooks = new RulesyncHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: content,
      validate: true,
    });

    // Ensure directory exists
    await ensureDir(join(outputRoot, relativeDirPath));

    // Write the file
    await writeFileContent(fullPath, content);

    const relativePathFromCwd = join(relativeDirPath, relativeFilePath);

    return {
      relativePathFromCwd,
      content: rulesyncHooks.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to write hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to delete the hooks configuration file
 */
async function deleteHooksFile(): Promise<{
  relativePathFromCwd: string;
}> {
  try {
    const outputRoot = process.cwd();
    const paths = RulesyncHooks.getSettablePaths();

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    await removeFile(filePath);

    const relativePathFromCwd = join(paths.relativeDirPath, paths.relativeFilePath);

    return {
      relativePathFromCwd,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Schema for hooks-related tool parameters
 */
export const hooksToolSchemas = {
  getHooksFile: z.object({}),
  putHooksFile: z.object({
    content: z.string(),
  }),
  deleteHooksFile: z.object({}),
} as const;

/**
 * Tool definitions for hooks-related operations
 */
export const hooksTools = {
  getHooksFile: {
    name: "getHooksFile",
    description: `Get the hooks configuration file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}).`,
    parameters: hooksToolSchemas.getHooksFile,
    execute: async () => {
      const result = await getHooksFile();
      return JSON.stringify(result, null, 2);
    },
  },
  putHooksFile: {
    name: "putHooksFile",
    description:
      "Create or update the hooks configuration file (upsert operation). content parameter is required and must be valid JSON.",
    parameters: hooksToolSchemas.putHooksFile,
    execute: async (args: { content: string }) => {
      const result = await putHooksFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteHooksFile: {
    name: "deleteHooksFile",
    description: "Delete the hooks configuration file.",
    parameters: hooksToolSchemas.deleteHooksFile,
    execute: async () => {
      const result = await deleteHooksFile();
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
