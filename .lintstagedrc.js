export default {
  "*": ["npx secretlint"],
  "package.json": ["npx sort-package-json"],
  "docs/**/*.md": ["tsx scripts/generate-docs-content.ts", "git add src/generated/docs-content.ts"],
  // Regenerate tool configurations when rulesync source files change
  ".rulesync/**/*": [() => "pnpm dev generate"],
};
