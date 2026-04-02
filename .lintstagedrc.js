export default {
  "*": ["npx secretlint"],
  "package.json": ["npx sort-package-json"],
  "docs/**/*.md": ["node --import tsx/esm scripts/sync-skill-docs.ts", "git add skills/rulesync/"],
  // Regenerate tool configurations when rulesync source files change
  ".rulesync/**/*": [() => "pnpm dev generate"],
};
