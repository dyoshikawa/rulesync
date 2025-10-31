import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import noTypeAssertion from "eslint-plugin-no-type-assertion";
import oxlint from "eslint-plugin-oxlint";
import strictDependencies from "eslint-plugin-strict-dependencies";
import zodImport from "eslint-plugin-zod-import";
import tseslint from "typescript-eslint";

/**
 * @type {import('eslint').Linter.Config}
 */
export default defineConfig([
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "*.config.js",
      "*.config.mjs",
      ".lintstagedrc.js",
      "eslint-plugin-*.js",
    ],
  },

  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
  },

  eslint.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "strict-dependencies": strictDependencies,
      import: importPlugin,
      "no-type-assertion": noTypeAssertion,
      "zod-import": zodImport,
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/ban-ts-comment": "off",
      "import/no-restricted-paths": "error",
      "no-type-assertion/no-type-assertion": "warn",
      "strict-dependencies/strict-dependencies": [
        "error",
        [
          {
            module: "node:fs",
            allowReferenceFrom: ["src/utils/file.ts", "src/utils/file.test.ts"],
            allowSameModule: false,
          },
          {
            module: "node:os",
            allowReferenceFrom: ["src/utils/file.ts", "src/utils/file.test.ts"],
            allowSameModule: false,
          },
          {
            module: "gray-matter",
            allowReferenceFrom: ["src/utils/frontmatter.ts"],
            allowSameModule: false,
          },
        ],
      ],
      "zod-import/zod-import": ["error", { variant: "zod-mini" }],
    },
  },

  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-empty": "off", // Allow empty test cases
      "@typescript-eslint/no-explicit-any": "off", // Allow any in tests
      "no-new": "off", // Allow new in tests
      "no-type-assertion/no-type-assertion": "off", // Allow type assertions in tests
    },
  },

  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
