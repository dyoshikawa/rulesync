import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts", "src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  fixedExtension: false,
});
