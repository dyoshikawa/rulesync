import { defineConfig } from "tsup";

export default defineConfig([
  // CLI build
  {
    name: "cli",
    entry: ["src/cli/index.ts"],
    format: ["cjs"],
    dts: false,
    clean: true,
    outDir: "dist",
    outExtension: () => ({ js: ".js" }),
    shims: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    splitting: false,
    sourcemap: false,
    minify: false,
  },
  // API build
  {
    name: "api",
    entry: ["src/api/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    outDir: "dist/api",
    outExtension: ({ format }) => ({ js: format === "cjs" ? ".js" : ".mjs" }),
    shims: true,
    splitting: false,
    sourcemap: true,
    minify: false,
  },
]);
