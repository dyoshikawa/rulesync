import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RulesyncRule } from "../../rules/rulesync-rule.js";
import { formatError } from "../../utils/error.js";
import { listDirectoryFiles } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

/**
 * Tool to list all rules from .rulesync/rules/*.md
 */
async function listRules({ baseDir }: { baseDir: string }): Promise<
  Array<{
    path: string;
    description: string;
    globs: string[];
  }>
> {
  const rulesDir = join(baseDir, ".rulesync", "rules");

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
            path: join(".rulesync", "rules", file),
            description: frontmatter.description ?? "",
            globs: frontmatter.globs ?? [],
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
 * MCP command that starts the MCP server
 */
export async function mcpCommand({ version }: { version: string }): Promise<void> {
  const baseDir = process.cwd();

  const server = new McpServer({
    name: "rulesync-mcp-server",
    version,
  });

  // Register listRules tool
  server.registerTool(
    "listRules",
    {
      title: "List Rules",
      description: "List all rules from .rulesync/rules/*.md with their summaries",
      inputSchema: {},
    },
    async () => {
      const rules = await listRules({ baseDir });
      const output = { rules };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  // Connect via stdio (for spawned processes)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Rulesync MCP server started via stdio");
}
