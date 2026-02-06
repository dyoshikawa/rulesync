export default {
  "*": ["npx secretlint"],
  "package.json": ["npx sort-package-json"],
  // Regenerate JSON Schema when config schema or related types change
  "src/config/config.ts": ["pnpm generate:schema", "git add config-schema.json"],
  "src/types/features.ts": ["pnpm generate:schema", "git add config-schema.json"],
  "src/types/tool-targets.ts": ["pnpm generate:schema", "git add config-schema.json"],
  "README.md": ["tsx scripts/sync-skill-readme.ts", "git add skills/rulesync/"],
  // Regenerate tool configurations when rulesync source files change
  ".rulesync/**/*": [() => "pnpm dev generate"],
};
