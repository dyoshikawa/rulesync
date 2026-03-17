import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as z from "zod";

// Import schemas directly from source - zod and zod/mini schemas are compatible in Zod v4
import { ConfigFileSchema } from "../src/config/config.js";
import {
  RULESYNC_CONFIG_SCHEMA_URL,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_PERMISSIONS_SCHEMA_URL,
} from "../src/constants/rulesync-paths.js";
import { RulesyncMcpFileSchema } from "../src/features/mcp/rulesync-mcp.js";
import { RulesyncPermissionsFileSchema } from "../src/features/permissions/rulesync-permissions.js";

type SchemaMeta = {
  $id: string;
  title: string;
  description: string;
};

// zod/mini schemas are compatible with toJSONSchema at runtime but not at the type level
// oxlint-disable-next-line no-explicit-any
function generateSchema(zodSchema: any, meta: SchemaMeta, outputPath: string): void {
  const generated = z.toJSONSchema(zodSchema, { reused: "ref" });
  const jsonSchema = {
    ...generated,
    $schema: "http://json-schema.org/draft-07/schema#",
    ...meta,
  };
  writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2) + "\n");
  // oxlint-disable-next-line no-console
  console.log(`JSON Schema generated: ${outputPath}`);
}

// Generate JSON Schema from the source schemas
// Note: zod/mini schemas work with zod's toJSONSchema in Zod v4
const outputPath = join(process.cwd(), "config-schema.json");
generateSchema(
  ConfigFileSchema,
  {
    $id: RULESYNC_CONFIG_SCHEMA_URL,
    title: "Rulesync Configuration",
    description: "Configuration file for Rulesync CLI tool",
  },
  outputPath,
);

const mcpOutputPath = join(process.cwd(), "mcp-schema.json");
generateSchema(
  RulesyncMcpFileSchema,
  {
    $id: RULESYNC_MCP_SCHEMA_URL,
    title: "Rulesync MCP Configuration",
    description: "MCP server configuration file for Rulesync CLI tool",
  },
  mcpOutputPath,
);

const permissionsOutputPath = join(process.cwd(), "permissions-schema.json");
generateSchema(
  RulesyncPermissionsFileSchema,
  {
    $id: RULESYNC_PERMISSIONS_SCHEMA_URL,
    title: "Rulesync Permissions Configuration",
    description: "Permissions configuration file for Rulesync CLI tool",
  },
  permissionsOutputPath,
);

// Format generated schema files with oxfmt for consistent formatting
execFileSync("npx", ["oxfmt", outputPath, mcpOutputPath, permissionsOutputPath]);
