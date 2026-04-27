import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { formatError } from "../utils/error.js";
import { ensureDir, removeFile, writeFileContent } from "../utils/file.js";

const maxPermissionsSizeBytes = 1024 * 1024; // 1MB

/**
 * Tool to get the permissions configuration file
 */
async function getPermissionsFile(): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  try {
    const rulesyncPermissions = await RulesyncPermissions.fromFile({
      validate: true,
    });

    const relativePathFromCwd = join(
      rulesyncPermissions.getRelativeDirPath(),
      rulesyncPermissions.getRelativeFilePath(),
    );

    return {
      relativePathFromCwd,
      content: rulesyncPermissions.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to read permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to create or update the permissions configuration file (upsert operation)
 */
async function putPermissionsFile({ content }: { content: string }): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  // Check file size constraint
  if (content.length > maxPermissionsSizeBytes) {
    throw new Error(
      `Permissions file size ${content.length} bytes exceeds maximum ${maxPermissionsSizeBytes} bytes (1MB) for ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}`,
    );
  }

  // Validate JSON format
  try {
    JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON format in permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  try {
    const outputRoot = process.cwd();
    const paths = RulesyncPermissions.getSettablePaths();

    const relativeDirPath = paths.relativeDirPath;
    const relativeFilePath = paths.relativeFilePath;
    const fullPath = join(outputRoot, relativeDirPath, relativeFilePath);

    // Create a RulesyncPermissions instance to validate the content
    const rulesyncPermissions = new RulesyncPermissions({
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
      content: rulesyncPermissions.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to write permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to delete the permissions configuration file
 */
async function deletePermissionsFile(): Promise<{
  relativePathFromCwd: string;
}> {
  try {
    const outputRoot = process.cwd();
    const paths = RulesyncPermissions.getSettablePaths();

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    await removeFile(filePath);

    const relativePathFromCwd = join(paths.relativeDirPath, paths.relativeFilePath);

    return {
      relativePathFromCwd,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Schema for permissions-related tool parameters
 */
export const permissionsToolSchemas = {
  getPermissionsFile: z.object({}),
  putPermissionsFile: z.object({
    content: z.string(),
  }),
  deletePermissionsFile: z.object({}),
} as const;

/**
 * Tool definitions for permissions-related operations
 */
export const permissionsTools = {
  getPermissionsFile: {
    name: "getPermissionsFile",
    description: `Get the permissions configuration file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}).`,
    parameters: permissionsToolSchemas.getPermissionsFile,
    execute: async () => {
      const result = await getPermissionsFile();
      return JSON.stringify(result, null, 2);
    },
  },
  putPermissionsFile: {
    name: "putPermissionsFile",
    description:
      "Create or update the permissions configuration file (upsert operation). content parameter is required and must be valid JSON.",
    parameters: permissionsToolSchemas.putPermissionsFile,
    execute: async (args: { content: string }) => {
      const result = await putPermissionsFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    },
  },
  deletePermissionsFile: {
    name: "deletePermissionsFile",
    description: "Delete the permissions configuration file.",
    parameters: permissionsToolSchemas.deletePermissionsFile,
    execute: async () => {
      const result = await deletePermissionsFile();
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
