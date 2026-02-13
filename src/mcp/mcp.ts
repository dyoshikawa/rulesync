import { join } from "node:path";
import { z } from "zod/mini";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { formatError } from "../utils/error.js";
import { ensureDir, removeFile, writeFileContent } from "../utils/file.js";

const maxMcpSizeBytes = 1024 * 1024; // 1MB

/**
 * Tool to get the MCP configuration file
 */
async function getMcpFile(): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  try {
    const rulesyncMcp = await RulesyncMcp.fromFile({
      validate: true,
    });

    const relativePathFromCwd = join(
      rulesyncMcp.getRelativeDirPath(),
      rulesyncMcp.getRelativeFilePath(),
    );

    return {
      relativePathFromCwd,
      content: rulesyncMcp.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to read MCP file (${RULESYNC_MCP_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to create or update the MCP configuration file (upsert operation)
 */
async function putMcpFile({ content }: { content: string }): Promise<{
  relativePathFromCwd: string;
  content: string;
}> {
  // Check file size constraint
  if (content.length > maxMcpSizeBytes) {
    throw new Error(
      `MCP file size ${content.length} bytes exceeds maximum ${maxMcpSizeBytes} bytes (1MB)`,
    );
  }

  // Validate JSON format
  try {
    JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON format in MCP file (${RULESYNC_MCP_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  try {
    const baseDir = process.cwd();
    const paths = RulesyncMcp.getSettablePaths();

    // Use recommended path
    const relativeDirPath = paths.recommended.relativeDirPath;
    const relativeFilePath = paths.recommended.relativeFilePath;
    const fullPath = join(baseDir, relativeDirPath, relativeFilePath);

    // Create a RulesyncMcp instance to validate the content
    const rulesyncMcp = new RulesyncMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: content,
      validate: true,
    });

    // Ensure directory exists
    await ensureDir(join(baseDir, relativeDirPath));

    // Write the file
    await writeFileContent(fullPath, content);

    const relativePathFromCwd = join(relativeDirPath, relativeFilePath);

    return {
      relativePathFromCwd,
      content: rulesyncMcp.getFileContent(),
    };
  } catch (error) {
    throw new Error(
      `Failed to write MCP file (${RULESYNC_MCP_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to delete the MCP configuration file
 */
async function deleteMcpFile(): Promise<{
  relativePathFromCwd: string;
}> {
  try {
    const baseDir = process.cwd();
    const paths = RulesyncMcp.getSettablePaths();

    // Try to delete both recommended and legacy paths
    const recommendedPath = join(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const legacyPath = join(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);

    // Remove recommended path if it exists
    await removeFile(recommendedPath);

    // Remove legacy path if it exists
    await removeFile(legacyPath);

    const relativePathFromCwd = join(
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );

    return {
      relativePathFromCwd,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete MCP file (${RULESYNC_MCP_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Schema for MCP-related tool parameters
 */
export const mcpToolSchemas = {
  getMcpFile: z.object({}),
  putMcpFile: z.object({
    content: z.string(),
  }),
  deleteMcpFile: z.object({}),
} as const;

/**
 * Tool definitions for MCP-related operations
 */
export const mcpTools = {
  getMcpFile: {
    name: "getMcpFile",
    description: `Get the MCP configuration file (${RULESYNC_MCP_RELATIVE_FILE_PATH}).`,
    parameters: mcpToolSchemas.getMcpFile,
    execute: async () => {
      const result = await getMcpFile();
      return JSON.stringify(result, null, 2);
    },
  },
  putMcpFile: {
    name: "putMcpFile",
    description:
      "Create or update the MCP configuration file (upsert operation). content parameter is required and must be valid JSON.",
    parameters: mcpToolSchemas.putMcpFile,
    execute: async (args: { content: string }) => {
      const result = await putMcpFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteMcpFile: {
    name: "deleteMcpFile",
    description: "Delete the MCP configuration file.",
    parameters: mcpToolSchemas.deleteMcpFile,
    execute: async () => {
      const result = await deleteMcpFile();
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
