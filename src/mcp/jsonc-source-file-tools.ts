import { join } from "node:path";

import { z } from "zod/mini";

import type { RulesyncFileParams } from "../types/rulesync-file.js";
import { formatError } from "../utils/error.js";
import { ensureDir, removeFile, writeFileContent } from "../utils/file.js";
import { parseJsonc } from "../utils/jsonc.js";
import {
  getRulesyncSourceCandidates,
  type RulesyncSourceSettablePaths,
  resolveRulesyncSourceWritePath,
} from "../utils/rulesync-source-path.js";
import { assertNoSymlinkInRulesyncSource } from "./feature-symlinks.js";

const maxJsoncSourceFileSizeBytes = 1024 * 1024; // 1MB

type JsoncSourceFile = {
  getRelativeDirPath(): string;
  getRelativeFilePath(): string;
  getFileContent(): string;
};

/**
 * The Rulesync source class behind a single JSONC configuration file
 * (`.rulesync/hooks.json`, `.rulesync/mcp.json`, ...).
 */
type JsoncSourceFileClass = {
  getSettablePaths(): RulesyncSourceSettablePaths;
  fromFile(params: { validate: boolean }): Promise<JsoncSourceFile>;
  new (params: RulesyncFileParams): JsoncSourceFile;
};

type JsoncSourceFileResult = {
  relativePathFromCwd: string;
  content: string;
};

const getToolSchema = z.object({});
const putToolSchema = z.object({
  content: z.string(),
});
const deleteToolSchema = z.object({});

export type JsoncSourceFileTools<TSuffix extends string> = {
  readonly [K in `get${TSuffix}File`]: {
    readonly name: K;
    readonly description: string;
    readonly parameters: typeof getToolSchema;
    readonly execute: () => Promise<string>;
  };
} & {
  readonly [K in `put${TSuffix}File`]: {
    readonly name: K;
    readonly description: string;
    readonly parameters: typeof putToolSchema;
    readonly execute: (args: { content: string }) => Promise<string>;
  };
} & {
  readonly [K in `delete${TSuffix}File`]: {
    readonly name: K;
    readonly description: string;
    readonly parameters: typeof deleteToolSchema;
    readonly execute: () => Promise<string>;
  };
};

/**
 * Builds the get/put/delete MCP tools for a Rulesync source that is a single
 * JSONC file, so the hooks, MCP and permissions tools share one implementation.
 *
 * @param toolNameSuffix - The part of the tool names between the verb and `File` (e.g. `Hooks` for `getHooksFile`).
 * @param label - How the file is named inside messages (e.g. `hooks` in "Failed to read hooks file").
 * @param sizeLabel - How the file is named at the start of the size error (e.g. `Hooks`).
 * @param relativeFilePath - The source path quoted in messages.
 * @param source - The Rulesync source class that reads, validates and locates the file.
 */
export function createJsoncSourceFileTools<const TSuffix extends string>({
  toolNameSuffix,
  label,
  sizeLabel,
  relativeFilePath,
  source,
}: {
  toolNameSuffix: TSuffix;
  label: string;
  sizeLabel: string;
  relativeFilePath: string;
  source: JsoncSourceFileClass;
}): JsoncSourceFileTools<TSuffix> {
  /**
   * Tool to get the configuration file
   */
  async function getFile(): Promise<JsoncSourceFileResult> {
    try {
      await assertNoSymlinkInRulesyncSource({
        outputRoot: process.cwd(),
        paths: source.getSettablePaths(),
      });
      const sourceFile = await source.fromFile({
        validate: true,
      });

      const relativePathFromCwd = join(
        sourceFile.getRelativeDirPath(),
        sourceFile.getRelativeFilePath(),
      );

      return {
        relativePathFromCwd,
        content: sourceFile.getFileContent(),
      };
    } catch (error) {
      throw new Error(`Failed to read ${label} file (${relativeFilePath}): ${formatError(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Tool to create or update the configuration file (upsert operation)
   */
  async function putFile({ content }: { content: string }): Promise<JsoncSourceFileResult> {
    // Check file size constraint
    if (content.length > maxJsoncSourceFileSizeBytes) {
      throw new Error(
        `${sizeLabel} file size ${content.length} bytes exceeds maximum ${maxJsoncSourceFileSizeBytes} bytes (1MB) for ${relativeFilePath}`,
      );
    }

    // Validate JSONC format
    try {
      parseJsonc(content);
    } catch (error) {
      throw new Error(
        `Invalid JSONC format in ${label} file (${relativeFilePath}): ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }

    try {
      const outputRoot = process.cwd();
      const paths = source.getSettablePaths();
      const { relativeDirPath, relativeFilePath: writeFilePath } =
        await resolveRulesyncSourceWritePath({
          outputRoot,
          paths,
        });
      const fullPath = join(outputRoot, relativeDirPath, writeFilePath);

      // Create a source instance to validate the content
      const sourceFile = new source({
        outputRoot,
        relativeDirPath,
        relativeFilePath: writeFilePath,
        fileContent: content,
        validate: true,
      });

      // Ensure directory exists
      await ensureDir(join(outputRoot, relativeDirPath));

      // Write the file
      await writeFileContent(fullPath, content);

      const relativePathFromCwd = join(relativeDirPath, writeFilePath);

      return {
        relativePathFromCwd,
        content: sourceFile.getFileContent(),
      };
    } catch (error) {
      throw new Error(
        `Failed to write ${label} file (${relativeFilePath}): ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Tool to delete the configuration file
   */
  async function deleteFile(): Promise<{
    relativePathFromCwd: string;
  }> {
    try {
      const outputRoot = process.cwd();
      const paths = source.getSettablePaths();

      for (const candidate of getRulesyncSourceCandidates({ paths })) {
        await removeFile(join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath));
      }

      const relativePathFromCwd = join(
        paths.recommended.relativeDirPath,
        paths.recommended.relativeFilePath,
      );

      return {
        relativePathFromCwd,
      };
    } catch (error) {
      throw new Error(
        `Failed to delete ${label} file (${relativeFilePath}): ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  const getName = `get${toolNameSuffix}File` as const;
  const putName = `put${toolNameSuffix}File` as const;
  const deleteName = `delete${toolNameSuffix}File` as const;

  // The mapped keys are computed from `toolNameSuffix`, which TypeScript cannot
  // follow through an object literal, so the assembled object is asserted.
  return {
    [getName]: {
      name: getName,
      description: `Get the ${label} configuration file (${relativeFilePath}).`,
      parameters: getToolSchema,
      execute: async () => {
        const result = await getFile();
        return JSON.stringify(result, null, 2);
      },
    },
    [putName]: {
      name: putName,
      description: `Create or update the ${label} configuration file (upsert operation). content parameter is required and must be valid JSONC.`,
      parameters: putToolSchema,
      execute: async (args: { content: string }) => {
        const result = await putFile({ content: args.content });
        return JSON.stringify(result, null, 2);
      },
    },
    [deleteName]: {
      name: deleteName,
      description: `Delete the ${label} configuration file.`,
      parameters: deleteToolSchema,
      execute: async () => {
        const result = await deleteFile();
        return JSON.stringify(result, null, 2);
      },
    },
  } as JsoncSourceFileTools<TSuffix>;
}
