import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as z from "zod";

// Import schema directly from source - zod and zod/mini schemas are compatible in Zod v4
import { ConfigFileSchema } from "../src/config/config.js";

// Generate JSON Schema from the source schema
// Note: zod/mini schemas work with zod's toJSONSchema in Zod v4
const generatedSchema = z.toJSONSchema(ConfigFileSchema, {
  reused: "ref",
});

// Add JSON Schema meta properties (override Zod's default $schema with draft-07 for broader compatibility)
const jsonSchema = {
  ...generatedSchema,
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
