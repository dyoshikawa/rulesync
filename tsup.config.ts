import { defineConfig } from "tsup";

export default defineConfig([
  // Library build (programmatic API)
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    treeshake: true,
  },
  // CLI build (separate entry point)
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    outDir: "dist/cli",
    splitting: false,
    sourcemap: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
