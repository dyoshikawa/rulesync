export default {
  "*": ["npx secretlint"],
  "package.json": ["npx sort-package-json"],
  // Regenerate JSON Schema when config/MCP schema or related types change
  "src/config/config.ts": ["pnpm generate:schema", "git add config-schema.json mcp-schema.json"],
  "src/types/features.ts": ["pnpm generate:schema", "git add config-schema.json mcp-schema.json"],
  "src/types/tool-targets.ts": [
    "pnpm generate:schema",
    "git add config-schema.json mcp-schema.json",
  ],
  "src/features/mcp/rulesync-mcp.ts": [
    "pnpm generate:schema",
    "git add config-schema.json mcp-schema.json",
  ],
  "src/types/mcp.ts": ["pnpm generate:schema", "git add config-schema.json mcp-schema.json"],
  "docs/**/*.md": ["tsx scripts/sync-skill-docs.ts", "git add skills/rulesync/"],
  // Regenerate tool configurations when rulesync source files change
  ".rulesync/**/*": [() => "pnpm dev generate"],
};
