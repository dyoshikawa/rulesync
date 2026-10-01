import { dirname, join, relative, resolve } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  RulesyncSubagent,
  type RulesyncSubagentFrontmatter,
  RulesyncSubagentFrontmatterSchema,
} from "../features/subagents/rulesync-subagent.js";
import { formatError } from "../utils/error.js";
import {
  assertWritablePathInsideRoot,
  checkPathTraversal,
  directoryExists,
  ensureDir,
  findFilesByGlobs,
  removeFile,
  splitPathSegments,
  writeFileContent,
} from "../utils/file.js";
import { ConsoleLogger } from "../utils/logger.js";

const logger = new ConsoleLogger({ verbose: false, silent: true });

const maxSubagentSizeBytes = 1024 * 1024; // 1MB
const maxSubagentsCount = 1000;

function getSubagentRelativeFilePath(relativePathFromCwd: string): string {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const subagentsDir = resolve(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
  const requestedPath = resolve(process.cwd(), relativePathFromCwd);
  const relativeFilePath = relative(subagentsDir, requestedPath);
  checkPathTraversal({ relativePath: relativeFilePath, intendedRootDir: subagentsDir });
  // `relative()` maps the directory itself to "", which would make `delete`
  // target the whole subagents directory; and a file without `.md` is never
  // listed or generated, so writing one would only create an invisible file.
  // Dot-prefixed segments are skipped by `list` and `generate` alike.
  if (
    relativeFilePath === "" ||
    !relativeFilePath.endsWith(".md") ||
    splitPathSegments(relativeFilePath).some((segment) => segment.startsWith("."))
  ) {
    throw new Error(
      `Subagent path must point to a .md file under ${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/: ${relativePathFromCwd}`,
    );
  }
  return relativeFilePath;
}

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
    const mdFiles = (
      await findFilesByGlobs("**/*.md", {
        cwd: subagentsDir,
        followSymbolicLinks: false,
      })
    )
      .map((file) => relative(subagentsDir, file))
      .toSorted();

    const subagents = await Promise.all(
      mdFiles.map(async (file) => {
        // Hold `list` to the same confinement as `get`, so a symlinked file
        // below the subagents directory is not listed and then refused. The
        // skip is intended, so it is not reported as a read failure.
        try {
          await assertWritablePathInsideRoot({
            rootPath: subagentsDir,
            targetPath: join(subagentsDir, file),
          });
        } catch (error) {
          logger.debug(`Skipping subagent file ${file}: ${formatError(error)}`);
          return null;
        }
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
  const relativeFilePath = getSubagentRelativeFilePath(relativePathFromCwd);
  const subagentsDir = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
  const fullPath = join(subagentsDir, relativeFilePath);

  try {
    if (!(await directoryExists(subagentsDir))) {
      throw new Error(`${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH} does not exist`);
    }
    // Only the part below the subagents directory is confined: `.rulesync`
    // or `.rulesync/subagents` may itself be a symlink (e.g. into a dotfiles
    // repository), which the CLI follows as well.
    await assertWritablePathInsideRoot({ rootPath: subagentsDir, targetPath: fullPath });
    const subagent = await RulesyncSubagent.fromFile({
      relativeFilePath,
      validate: true,
    });

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath),
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
  const relativeFilePath = getSubagentRelativeFilePath(relativePathFromCwd);
  const subagentsDir = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
  const fullPath = join(subagentsDir, relativeFilePath);

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
        subagent.relativePathFromCwd ===
        join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath),
    );

    if (!isUpdate && existingSubagents.length >= maxSubagentsCount) {
      throw new Error(
        `Maximum number of subagents (${maxSubagentsCount}) reached in ${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}`,
      );
    }

    // Create a new RulesyncSubagent instance
    const subagent = new RulesyncSubagent({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter,
      body,
      validate: true,
    });

    // Ensure directory exists
    await ensureDir(subagentsDir);
    await assertWritablePathInsideRoot({ rootPath: subagentsDir, targetPath: fullPath });
    await ensureDir(join(subagentsDir, dirname(relativeFilePath)));
    await assertWritablePathInsideRoot({ rootPath: subagentsDir, targetPath: fullPath });

    // Write the file
    await writeFileContent(subagent.getFilePath(), subagent.getFileContent());

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath),
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
  const relativeFilePath = getSubagentRelativeFilePath(relativePathFromCwd);
  const subagentsDir = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
  const fullPath = join(subagentsDir, relativeFilePath);

  try {
    // Nothing to delete; stay idempotent like deleting a missing file.
    if (!(await directoryExists(subagentsDir))) {
      return { relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath) };
    }
    // Only the part below the subagents directory is confined: `.rulesync`
    // or `.rulesync/subagents` may itself be a symlink (e.g. into a dotfiles
    // repository), which the CLI follows as well.
    await assertWritablePathInsideRoot({ rootPath: subagentsDir, targetPath: fullPath });
    await removeFile(fullPath);

    return {
      relativePathFromCwd: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath),
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
const subagentToolSchemas = {
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
    description: `List all subagents from ${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "**/*.md")} with their frontmatter.`,
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
