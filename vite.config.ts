import { defineConfig } from "vite-plus";

// One file configures the Vite+ toolchain: the npm package build (`pack`), the
// formatter (`fmt`), the linter (`lint`) and the pre-commit checks (`staged`).
// The unit and E2E tests keep their own `vitest.config.ts` /
// `vitest.e2e.config.ts`. The docs site is built by VitePress with its own
// Vite, not by `vp`.
export default defineConfig({
  // `vp pack` (tsdown): the published `dist/` (see package.json `exports`/`bin`).
  pack: {
    entry: ["src/cli/index.ts", "src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    fixedExtension: false,
  },

  // `vp fmt` (Oxfmt).
  fmt: {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    arrowParens: "always",
    experimentalSortImports: {},
    ignorePatterns: [
      "package.json",
      ".gemini/**",
      "node_modules/**",
      "dist/**",
      "dist*/**",
      "opencode.json",
      ".zed/settings.json",
      ".vscode/settings.json",
      ".claude/settings.json",
      ".serena/project.yml",
      ".github/copilot-instructions.md",
      ".github/instructions/**",
      "rulesync.local.jsonc",
    ],
    overrides: [
      {
        files: ["**/*.json", "**/*.jsonc"],
        options: { trailingComma: "none" },
      },
    ],
  },

  // `vp lint` (Oxlint). Type checking stays with `tsgo` (`pnpm typecheck`):
  // Oxlint's type-aware mode would add rules this repository does not use.
  lint: {
    plugins: ["typescript", "import", "unicorn"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      style: "off",
      pedantic: "off",
    },
    rules: {
      complexity: ["error", { max: 20 }],
      eqeqeq: "error",
      "import/no-cycle": "error",
      "no-console": "error",
      "no-new": "off",
      "no-underscore-dangle": "off",
      "typescript/no-explicit-any": "warn",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/no-array-reduce": "off",
      "unicorn/consistent-function-scoping": "off",
    },
    env: {
      browser: false,
      node: true,
      es2024: true,
    },
    ignorePatterns: ["dist/**", "coverage/**", "*.d.ts", "node_modules/**"],
    overrides: [
      {
        files: ["**/*.test.ts"],
        rules: {
          "typescript/no-explicit-any": "off",
          "no-console": "error",
        },
      },
      {
        files: ["src/utils/logger.ts"],
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["src/cli/index.ts"],
        rules: {
          "no-console": "off",
        },
      },
    ],
  },

  // `vp staged`, run by the pre-commit hook (`.vite-hooks/pre-commit`).
  staged: {
    "*": ["npx secretlint"],
    "package.json": ["npx sort-package-json"],
    "docs/**/*.md": [
      "tsx scripts/generate-docs-content.ts",
      "git add src/generated/docs-content.ts",
    ],
    // Regenerate tool configurations when rulesync source files change
    ".rulesync/**/*": [() => "pnpm dev generate"],
  },
});
