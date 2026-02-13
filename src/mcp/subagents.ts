import { basename, join } from "node:path";
import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  RulesyncSubagent,
  type RulesyncSubagentFrontmatter,
  RulesyncSubagentFrontmatterSchema,
} from "../features/subagents/rulesync-subagent.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  ensureDir,
  listDirectoryFiles,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";

const maxSubagentSizeBytes = 1024 * 1024; // 1MB
const maxSubagentsCount = 1000;

/**
 * Tool to list all subagents from .rulesync/subagents/*.md
 */
async function listSubagents(): Promise<
  Array<{
    relativePathFromCwd: string;
    frontmatter: RulesyncSubagentFrontmatter;
  }>
> {
  const subagentsDir = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);

  try {
    const files = await listDirectoryFiles(subagentsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    const subagents = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          // Read the subagent file using RulesyncSubagent
          const subagent = await RulesyncSubagent.fromFile({
            relativeFilePath: file,
            validate: true,
          });

          const frontmatter = subagent.getFrontmatter();

          return {
            relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, file),
            frontmatter,
          };
        } catch (error) {
          logger.error(`Failed to read subagent file ${file}: ${formatError(error)}`);
          return null;
        }
      }),
    );

    // Filter out null values (failed reads)
    return subagents.filter(
      (subagent): subagent is NonNullable<typeof subagent> => subagent !== null,
    );
  } catch (error) {
    logger.error(
      `Failed to read subagents directory (${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}): ${formatError(error)}`,
    );
    return [];
  }
}

/**
 * Tool to get detailed information about a specific subagent
 */
async function getSubagent({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncSubagentFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  try {
    const subagent = await RulesyncSubagent.fromFile({
      relativeFilePath: filename,
      validate: true,
    });

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
      frontmatter: subagent.getFrontmatter(),
      body: subagent.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to read subagent file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to create or update a subagent (upsert operation)
 */
async function putSubagent({
  relativePathFromCwd,
  frontmatter,
  body,
}: {
  relativePathFromCwd: string;
  frontmatter: RulesyncSubagentFrontmatter;
  body: string;
}): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncSubagentFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  // Check file size constraint
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxSubagentSizeBytes) {
    throw new Error(
      `Subagent size ${estimatedSize} bytes exceeds maximum ${maxSubagentSizeBytes} bytes (1MB) for ${relativePathFromCwd}`,
    );
  }

  try {
    // Check subagent count constraint
    const existingSubagents = await listSubagents();
    const isUpdate = existingSubagents.some(
      (subagent) =>
        subagent.relativePathFromCwd === join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
    );

    if (!isUpdate && existingSubagents.length >= maxSubagentsCount) {
      throw new Error(`Maximum number of subagents (${maxSubagentsCount}) reached`);
    }

    // Create a new RulesyncSubagent instance
    const subagent = new RulesyncSubagent({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: filename,
      frontmatter,
      body,
      validate: true,
    });

    // Ensure directory exists
    const subagentsDir = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
    await ensureDir(subagentsDir);

    // Write the file
    await writeFileContent(subagent.getFilePath(), subagent.getFileContent());

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
      frontmatter: subagent.getFrontmatter(),
      body: subagent.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to write subagent file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to delete a subagent
 */
async function deleteSubagent({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);
  const fullPath = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename);

  try {
    await removeFile(fullPath);

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
    };
  } catch (error) {
    throw new Error(
      `Failed to delete subagent file ${relativePathFromCwd}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Schema for subagent-related tool parameters
 */
export const subagentToolSchemas = {
  listSubagents: z.object({}),
  getSubagent: z.object({
    relativePathFromCwd: z.string(),
  }),
  putSubagent: z.object({
    relativePathFromCwd: z.string(),
    frontmatter: RulesyncSubagentFrontmatterSchema,
    body: z.string(),
  }),
  deleteSubagent: z.object({
    relativePathFromCwd: z.string(),
  }),
} as const;

/**
 * Tool definitions for subagent-related operations
 */
export const subagentTools = {
  listSubagents: {
    name: "listSubagents",
    description: `List all subagents from ${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "*.md")} with their frontmatter.`,
    parameters: subagentToolSchemas.listSubagents,
    execute: async () => {
      const subagents = await listSubagents();
      const output = { subagents };
      return JSON.stringify(output, null, 2);
    },
  },
  getSubagent: {
    name: "getSubagent",
    description:
      "Get detailed information about a specific subagent. relativePathFromCwd parameter is required.",
    parameters: subagentToolSchemas.getSubagent,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await getSubagent({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
  putSubagent: {
    name: "putSubagent",
    description:
      "Create or update a subagent (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: subagentToolSchemas.putSubagent,
    execute: async (args: {
      relativePathFromCwd: string;
      frontmatter: RulesyncSubagentFrontmatter;
      body: string;
    }) => {
      const result = await putSubagent({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
      });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteSubagent: {
    name: "deleteSubagent",
    description: "Delete a subagent file. relativePathFromCwd parameter is required.",
    parameters: subagentToolSchemas.deleteSubagent,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await deleteSubagent({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
