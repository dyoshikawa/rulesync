import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import noTypeAssertion from "eslint-plugin-no-type-assertion";
import oxlint from "eslint-plugin-oxlint";
import tseslint from "typescript-eslint";
import zodMiniPlugin from "./eslint-plugin-zod-import.js";

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
    files: ["**/*.{js,mjs,cjs,ts,mts}"],
  },

  eslint.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "no-type-assertion": noTypeAssertion,
      "zod-mini": zodMiniPlugin,
    },
    rules: {
      "no-type-assertion/no-type-assertion": "warn",
      "zod-mini/use-zod-mini": "error",
    },
  },

  {
    files: ["**/*.test.ts"],
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
      "no-type-assertion/no-type-assertion": "off", // Allow type assertions in tests
    },
  },

  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
