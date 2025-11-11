import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "../../rules/rulesync-rule.js";
import { formatError } from "../../utils/error.js";
import { ensureDir, listDirectoryFiles, removeFile, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

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
  const filename = basename(relativePathFromCwd);

  try {
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
  const server = new McpServer({
    name: "rulesync-mcp-server",
    version,
  });

  // Register listRules tool
  server.registerTool(
    "listRules",
    {
      title: "List Rules",
      description: "List all rules from .rulesync/rules/*.md with their frontmatter",
      inputSchema: {},
    },
    async () => {
      const rules = await listRules();
      const output = { rules };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  // Register getRule tool
  server.registerTool(
    "getRule",
    {
      title: "Get Rule",
      description:
        "Get detailed information about a specific rule. relativePathFromCwd parameter is required.",
      inputSchema: {
        type: "object",
        properties: {
          relativePathFromCwd: {
            type: "string",
            description: "Path to the rule file (e.g., '.rulesync/rules/overview.md')",
          },
        },
      } as /* oxlint-disable-next-line typescript-eslint/no-explicit-any */ /* eslint-disable-line no-type-assertion/no-type-assertion -- JSON Schema type definition incompatibility */ any,
    },
    async (args: unknown) => {
      // Type guard for args
      if (typeof args !== "object" || args === null || !("relativePathFromCwd" in args)) {
        throw new Error("Invalid arguments: relativePathFromCwd is required");
      }
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const argObj = args as Record<string, unknown>;
      if (typeof argObj.relativePathFromCwd !== "string") {
        throw new Error("Invalid arguments: relativePathFromCwd must be a string");
      }
      const result = await getRule({ relativePathFromCwd: argObj.relativePathFromCwd });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  // Register putRule tool
  server.registerTool(
    "putRule",
    {
      title: "Put Rule",
      description:
        "Create or update a rule (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
      inputSchema: {
        type: "object",
        properties: {
          relativePathFromCwd: {
            type: "string",
            description: "Path to the rule file (e.g., '.rulesync/rules/new-rule.md')",
          },
          frontmatter: {
            type: "object",
            description: "Frontmatter metadata for the rule",
          },
          body: {
            type: "string",
            description: "Body content of the rule",
          },
        },
      } as /* oxlint-disable-next-line typescript-eslint/no-explicit-any */ /* eslint-disable-line no-type-assertion/no-type-assertion -- JSON Schema type definition incompatibility */ any,
    },
    async (args: unknown) => {
      // Type guard for args
      if (typeof args !== "object" || args === null) {
        throw new Error(
          "Invalid arguments: relativePathFromCwd, frontmatter, and body are required",
        );
      }
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const argObj = args as Record<string, unknown>;
      if (typeof argObj.relativePathFromCwd !== "string") {
        throw new Error("Invalid arguments: relativePathFromCwd must be a string");
      }
      if (typeof argObj.frontmatter !== "object" || argObj.frontmatter === null) {
        throw new Error("Invalid arguments: frontmatter must be an object");
      }
      if (typeof argObj.body !== "string") {
        throw new Error("Invalid arguments: body must be a string");
      }
      const result = await putRule({
        relativePathFromCwd: argObj.relativePathFromCwd,
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        frontmatter: argObj.frontmatter as RulesyncRuleFrontmatter,
        body: argObj.body,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  // Register deleteRule tool
  server.registerTool(
    "deleteRule",
    {
      title: "Delete Rule",
      description: "Delete a rule file. relativePathFromCwd parameter is required.",
      inputSchema: {
        type: "object",
        properties: {
          relativePathFromCwd: {
            type: "string",
            description: "Path to the rule file to delete (e.g., '.rulesync/rules/old-rule.md')",
          },
        },
      } as /* oxlint-disable-next-line typescript-eslint/no-explicit-any */ /* eslint-disable-line no-type-assertion/no-type-assertion -- JSON Schema type definition incompatibility */ any,
    },
    async (args: unknown) => {
      // Type guard for args
      if (typeof args !== "object" || args === null || !("relativePathFromCwd" in args)) {
        throw new Error("Invalid arguments: relativePathFromCwd is required");
      }
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const argObj = args as Record<string, unknown>;
      if (typeof argObj.relativePathFromCwd !== "string") {
        throw new Error("Invalid arguments: relativePathFromCwd must be a string");
      }
      const result = await deleteRule({ relativePathFromCwd: argObj.relativePathFromCwd });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  // Connect via stdio (for spawned processes)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Rulesync MCP server started via stdio");
}
