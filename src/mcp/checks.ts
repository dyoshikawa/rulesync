import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  RulesyncCheck,
  type RulesyncCheckFrontmatter,
  RulesyncCheckFrontmatterSchema,
} from "../features/checks/rulesync-check.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  ensureDir,
  listDirectoryFiles,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { ConsoleLogger } from "../utils/logger.js";

const logger = new ConsoleLogger({ verbose: false, silent: true });

const maxCheckSizeBytes = 1024 * 1024; // 1MB
const maxChecksCount = 1000;

/**
 * Tool to list all checks from .rulesync/checks/*.md
 */
async function listChecks(): Promise<
  Array<{
    relativePathFromCwd: string;
    frontmatter: RulesyncCheckFrontmatter;
  }>
> {
  const checksDir = join(process.cwd(), RULESYNC_CHECKS_RELATIVE_DIR_PATH);

  try {
    const files = await listDirectoryFiles(checksDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    const checks = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          const check = await RulesyncCheck.fromFile({
            relativeFilePath: file,
            validate: true,
          });

          return {
            relativePathFromCwd: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, file),
            frontmatter: check.getFrontmatter(),
          };
        } catch (error) {
          logger.error(`Failed to read check file ${file}: ${formatError(error)}`);
          return null;
        }
      }),
    );

    // Filter out null values (failed reads)
    return checks.filter((check): check is NonNullable<typeof check> => check !== null);
  } catch (error) {
    logger.error(
      `Failed to read checks directory (${RULESYNC_CHECKS_RELATIVE_DIR_PATH}): ${formatError(error)}`,
    );
    return [];
  }
}

/**
 * Tool to get detailed information about a specific check
 */
async function getCheck({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncCheckFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  try {
    const check = await RulesyncCheck.fromFile({
      relativeFilePath: filename,
      validate: true,
    });

    return {
      relativePathFromCwd: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, filename),
      frontmatter: check.getFrontmatter(),
      body: check.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to read check file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to create or update a check (upsert operation)
 */
async function putCheck({
  relativePathFromCwd,
  frontmatter,
  body,
}: {
  relativePathFromCwd: string;
  frontmatter: RulesyncCheckFrontmatter;
  body: string;
}): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncCheckFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  // Check file size constraint
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxCheckSizeBytes) {
    throw new Error(
      `Check size ${estimatedSize} bytes exceeds maximum ${maxCheckSizeBytes} bytes (1MB) for ${relativePathFromCwd}`,
    );
  }

  try {
    // Check count constraint
    const existingChecks = await listChecks();
    const isUpdate = existingChecks.some(
      (check) => check.relativePathFromCwd === join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, filename),
    );

    if (!isUpdate && existingChecks.length >= maxChecksCount) {
      throw new Error(
        `Maximum number of checks (${maxChecksCount}) reached in ${RULESYNC_CHECKS_RELATIVE_DIR_PATH}`,
      );
    }

    const check = new RulesyncCheck({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: filename,
      frontmatter,
      body,
      validate: true,
    });

    // Ensure directory exists
    const checksDir = join(process.cwd(), RULESYNC_CHECKS_RELATIVE_DIR_PATH);
    await ensureDir(checksDir);

    // Write the file
    await writeFileContent(check.getFilePath(), check.getFileContent());

    return {
      relativePathFromCwd: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, filename),
      frontmatter: check.getFrontmatter(),
      body: check.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to write check file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to delete a check
 */
async function deleteCheck({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);
  const fullPath = join(process.cwd(), RULESYNC_CHECKS_RELATIVE_DIR_PATH, filename);

  try {
    await removeFile(fullPath);

    return {
      relativePathFromCwd: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, filename),
    };
  } catch (error) {
    throw new Error(`Failed to delete check file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Schema for check-related tool parameters
 */
const checkToolSchemas = {
  listChecks: z.object({}),
  getCheck: z.object({
    relativePathFromCwd: z.string(),
  }),
  putCheck: z.object({
    relativePathFromCwd: z.string(),
    frontmatter: RulesyncCheckFrontmatterSchema,
    body: z.string(),
  }),
  deleteCheck: z.object({
    relativePathFromCwd: z.string(),
  }),
} as const;

/**
 * Tool definitions for check-related operations
 */
export const checkTools = {
  listChecks: {
    name: "listChecks",
    description: `List all checks from ${join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, "*.md")} with their frontmatter.`,
    parameters: checkToolSchemas.listChecks,
    execute: async () => {
      const checks = await listChecks();
      const output = { checks };
      return JSON.stringify(output, null, 2);
    },
  },
  getCheck: {
    name: "getCheck",
    description:
      "Get detailed information about a specific check. relativePathFromCwd parameter is required.",
    parameters: checkToolSchemas.getCheck,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await getCheck({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
  putCheck: {
    name: "putCheck",
    description:
      "Create or update a check (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: checkToolSchemas.putCheck,
    execute: async (args: {
      relativePathFromCwd: string;
      frontmatter: RulesyncCheckFrontmatter;
      body: string;
    }) => {
      const result = await putCheck({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
      });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteCheck: {
    name: "deleteCheck",
    description: "Delete a check file. relativePathFromCwd parameter is required.",
    parameters: checkToolSchemas.deleteCheck,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await deleteCheck({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
