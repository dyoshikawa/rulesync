import { basename, join } from "node:path";
import { FastMCP } from "fastmcp";
import { z } from "zod/mini";
import {
  RulesyncRule,
  type RulesyncRuleFrontmatter,
  RulesyncRuleFrontmatterSchema,
} from "../../rules/rulesync-rule.js";
import { formatError } from "../../utils/error.js";
import {
  ensureDir,
  listDirectoryFiles,
  removeFile,
  resolvePath,
  writeFileContent,
} from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

// Resource constraints
const MAX_RULE_SIZE_BYTES = 1024 * 1024; // 1MB
const MAX_RULES_COUNT = 1000;
const RULES_DIR_PREFIX = ".rulesync/rules";

/**
 * Validates that a rule path is safe and follows the expected format
 * @throws {Error} if path validation fails
 */
function validateRulePath(relativePathFromCwd: string): void {
  // Normalize path separators for cross-platform compatibility
  const normalizedPath = relativePathFromCwd.replace(/\\/g, "/");

  // Ensure path is within .rulesync/rules/
  if (!normalizedPath.startsWith(`${RULES_DIR_PREFIX}/`)) {
    throw new Error(`Invalid rule path: must be within ${RULES_DIR_PREFIX}/ directory`);
  }

  // Use resolvePath to check for path traversal
  try {
    resolvePath(normalizedPath, process.cwd());
  } catch (error) {
    throw new Error(`Path validation failed: ${formatError(error)}`, { cause: error });
  }

  // Validate filename
  const filename = basename(normalizedPath);
  if (!/^[a-zA-Z0-9_-]+\.md$/.test(filename)) {
    throw new Error(
      `Invalid filename: ${filename}. Must match pattern [a-zA-Z0-9_-]+.md (alphanumeric, hyphens, underscores only)`,
    );
  }
}

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
  // Validate path before processing
  validateRulePath(relativePathFromCwd);

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
  // Validate path before processing
  validateRulePath(relativePathFromCwd);

  const filename = basename(relativePathFromCwd);

  // Check file size constraint
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > MAX_RULE_SIZE_BYTES) {
    throw new Error(
      `Rule size ${estimatedSize} bytes exceeds maximum ${MAX_RULE_SIZE_BYTES} bytes (1MB)`,
    );
  }

  try {
    // Check rule count constraint
    const existingRules = await listRules();
    const isUpdate = existingRules.some(
      (rule) => rule.relativePathFromCwd === join(".rulesync", "rules", filename),
    );

    if (!isUpdate && existingRules.length >= MAX_RULES_COUNT) {
      throw new Error(`Maximum number of rules (${MAX_RULES_COUNT}) reached`);
    }

    // Create a new RulesyncRule instance
    const rule = new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: ".rulesync/rules",
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
  // Validate path before processing
  validateRulePath(relativePathFromCwd);

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
 * MCP command that starts the MCP server
 */
export async function mcpCommand({ version }: { version: string }): Promise<void> {
  const server = new FastMCP({
    name: "rulesync-mcp-server",
    // Type assertion is safe here because version comes from package.json which follows semver
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    version: version as `${number}.${number}.${number}`,
  });

  // Register listRules tool
  server.addTool({
    name: "listRules",
    description: "List all rules from .rulesync/rules/*.md with their frontmatter",
    parameters: z.object({}),
    execute: async () => {
      const rules = await listRules();
      const output = { rules };
      return JSON.stringify(output, null, 2);
    },
  });

  // Register getRule tool
  server.addTool({
    name: "getRule",
    description:
      "Get detailed information about a specific rule. relativePathFromCwd parameter is required.",
    parameters: z.object({
      relativePathFromCwd: z.string(),
    }),
    execute: async (args) => {
      const result = await getRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  });

  // Register putRule tool
  server.addTool({
    name: "putRule",
    description:
      "Create or update a rule (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: z.object({
      relativePathFromCwd: z.string(),
      frontmatter: RulesyncRuleFrontmatterSchema,
      body: z.string(),
    }),
    execute: async (args) => {
      const result = await putRule({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  // Register deleteRule tool
  server.addTool({
    name: "deleteRule",
    description: "Delete a rule file. relativePathFromCwd parameter is required.",
    parameters: z.object({
      relativePathFromCwd: z.string(),
    }),
    execute: async (args) => {
      const result = await deleteRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  });

  // Start server with stdio transport (for spawned processes)
  logger.info("Rulesync MCP server started via stdio");

  // Start the server - this blocks execution and runs the MCP server
  // The void operator explicitly marks this as intentionally not awaited
  void server.start({
    transportType: "stdio",
  });
}
