import { basename, join } from "node:path";
import { z } from "zod/mini";
import {
  RulesyncRule,
  type RulesyncRuleFrontmatter,
  RulesyncRuleFrontmatterSchema,
} from "../features/rules/rulesync-rule.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  ensureDir,
  listDirectoryFiles,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";

const maxRuleSizeBytes = 1024 * 1024; // 1MB
const maxRulesCount = 1000;

/**
 * Tool to list all rules from .rulesync/rules/*.md
 */
async function listRules(): Promise<
  Array<{
    relativePathFromCwd: string;
    frontmatter: RulesyncRuleFrontmatter;
  }>
> {
  const rulesDir = join(process.cwd(), ".rulesync", "rules");

  try {
    const files = await listDirectoryFiles(rulesDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    const rules = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          // Read the rule file using RulesyncRule
          const rule = await RulesyncRule.fromFile({
            relativeFilePath: file,
            validate: true,
          });

          const frontmatter = rule.getFrontmatter();

          return {
            relativePathFromCwd: join(".rulesync", "rules", file),
            frontmatter,
          };
        } catch (error) {
          logger.error(`Failed to read rule file ${file}: ${formatError(error)}`);
          return null;
        }
      }),
    );

    // Filter out null values (failed reads)
    return rules.filter((rule): rule is NonNullable<typeof rule> => rule !== null);
  } catch (error) {
    logger.error(`Failed to read rules directory: ${formatError(error)}`);
    return [];
  }
}

/**
 * Tool to get detailed information about a specific rule
 */
async function getRule({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncRuleFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  try {
    const rule = await RulesyncRule.fromFile({
      relativeFilePath: filename,
      validate: true,
    });

    return {
      relativePathFromCwd: join(".rulesync", "rules", filename),
      frontmatter: rule.getFrontmatter(),
      body: rule.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to read rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to create or update a rule (upsert operation)
 */
async function putRule({
  relativePathFromCwd,
  frontmatter,
  body,
}: {
  relativePathFromCwd: string;
  frontmatter: RulesyncRuleFrontmatter;
  body: string;
}): Promise<{
  relativePathFromCwd: string;
  frontmatter: RulesyncRuleFrontmatter;
  body: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);

  // Check file size constraint
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxRuleSizeBytes) {
    throw new Error(
      `Rule size ${estimatedSize} bytes exceeds maximum ${maxRuleSizeBytes} bytes (1MB)`,
    );
  }

  try {
    // Check rule count constraint
    const existingRules = await listRules();
    const isUpdate = existingRules.some(
      (rule) => rule.relativePathFromCwd === join(".rulesync", "rules", filename),
    );

    if (!isUpdate && existingRules.length >= maxRulesCount) {
      throw new Error(`Maximum number of rules (${maxRulesCount}) reached`);
    }

    // Create a new RulesyncRule instance
    const rule = new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: join(".rulesync", "rules"),
      relativeFilePath: filename,
      frontmatter,
      body,
      validate: true,
    });

    // Ensure directory exists
    const rulesDir = join(process.cwd(), ".rulesync", "rules");
    await ensureDir(rulesDir);

    // Write the file
    await writeFileContent(rule.getFilePath(), rule.getFileContent());

    return {
      relativePathFromCwd: join(".rulesync", "rules", filename),
      frontmatter: rule.getFrontmatter(),
      body: rule.getBody(),
    };
  } catch (error) {
    throw new Error(`Failed to write rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Tool to delete a rule
 */
async function deleteRule({ relativePathFromCwd }: { relativePathFromCwd: string }): Promise<{
  relativePathFromCwd: string;
}> {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const filename = basename(relativePathFromCwd);
  const fullPath = join(process.cwd(), ".rulesync", "rules", filename);

  try {
    await removeFile(fullPath);

    return {
      relativePathFromCwd: join(".rulesync", "rules", filename),
    };
  } catch (error) {
    throw new Error(`Failed to delete rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Schema for rule-related tool parameters
 */
export const ruleToolSchemas = {
  listRules: z.object({}),
  getRule: z.object({
    relativePathFromCwd: z.string(),
  }),
  putRule: z.object({
    relativePathFromCwd: z.string(),
    frontmatter: RulesyncRuleFrontmatterSchema,
    body: z.string(),
  }),
  deleteRule: z.object({
    relativePathFromCwd: z.string(),
  }),
} as const;

/**
 * Tool definitions for rule-related operations
 */
export const ruleTools = {
  listRules: {
    name: "listRules",
    description: `List all rules from ${join(".rulesync", "rules", "*.md")} with their frontmatter.`,
    parameters: ruleToolSchemas.listRules,
    execute: async () => {
      const rules = await listRules();
      const output = { rules };
      return JSON.stringify(output, null, 2);
    },
  },
  getRule: {
    name: "getRule",
    description:
      "Get detailed information about a specific rule. relativePathFromCwd parameter is required.",
    parameters: ruleToolSchemas.getRule,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await getRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
  putRule: {
    name: "putRule",
    description:
      "Create or update a rule (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: ruleToolSchemas.putRule,
    execute: async (args: {
      relativePathFromCwd: string;
      frontmatter: RulesyncRuleFrontmatter;
      body: string;
    }) => {
      const result = await putRule({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
      });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteRule: {
    name: "deleteRule",
    description: "Delete a rule file. relativePathFromCwd parameter is required.",
    parameters: ruleToolSchemas.deleteRule,
    execute: async (args: { relativePathFromCwd: string }) => {
      const result = await deleteRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
