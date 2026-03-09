import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as z from "zod";

// Import schemas directly from source - zod and zod/mini schemas are compatible in Zod v4
import { ConfigFileSchema } from "../src/config/config.js";
import { RulesyncMcpFileSchema } from "../src/features/mcp/rulesync-mcp.js";

// Generate JSON Schema from the source schema
// Note: zod/mini schemas work with zod's toJSONSchema in Zod v4
const generatedSchema = z.toJSONSchema(ConfigFileSchema, {
  reused: "ref",
});

// Add descriptions to source entry fields (zod/mini lacks .describe())
// Round-trip through JSON to get a plain object we can mutate without type assertions
const schemaObj = JSON.parse(JSON.stringify(generatedSchema));
const sourceProps = schemaObj?.properties?.sources?.items?.properties;
if (sourceProps) {
  if (sourceProps.source)
    sourceProps.source.description = "Repository identifier (e.g., 'org/repo' or a full URL).";
  if (sourceProps.skills)
    sourceProps.skills.description =
      "Skill names to fetch. Omit to fetch all skills from the source.";
  if (sourceProps.transport)
    sourceProps.transport.description =
      "Transport protocol for fetching skills. 'github' uses the GitHub REST API (default). 'git' uses the git CLI and works with any git remote.";
  if (sourceProps.ref)
    sourceProps.ref.description =
      "Git ref (branch or tag) to fetch skills from. Defaults to the repository's default branch.";
  if (sourceProps.path)
    sourceProps.path.description =
      "Path to the skills directory within the repository. Defaults to 'skills'.";
}

// Add JSON Schema meta properties (override Zod's default $schema with draft-07 for broader compatibility)
const jsonSchema = {
  ...schemaObj,
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  title: "Rulesync Configuration",
  description: "Configuration file for Rulesync CLI tool",
};

// Output to project root
const outputPath = join(process.cwd(), "config-schema.json");

// Write schema file
writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2) + "\n");

// oxlint-disable-next-line no-console
console.log(`JSON Schema generated: ${outputPath}`);

// Generate MCP JSON Schema
const generatedMcpSchema = z.toJSONSchema(RulesyncMcpFileSchema, {
  reused: "ref",
});

const mcpJsonSchema = {
  ...generatedMcpSchema,
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/mcp-schema.json",
  title: "Rulesync MCP Configuration",
  description: "MCP server configuration file for Rulesync CLI tool",
};

const mcpOutputPath = join(process.cwd(), "mcp-schema.json");

writeFileSync(mcpOutputPath, JSON.stringify(mcpJsonSchema, null, 2) + "\n");

// oxlint-disable-next-line no-console
console.log(`MCP JSON Schema generated: ${mcpOutputPath}`);

// Format generated schema files with oxfmt for consistent formatting
execSync(`npx oxfmt ${outputPath} ${mcpOutputPath}`);
