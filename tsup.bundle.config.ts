import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli/index.ts"],
	format: ["esm"],
	outDir: "dist-bun",
	noExternal: [/.*/], // Bundle all dependencies
	outExtension: () => ({ js: ".js" }),
	clean: true,
	minify: false,
	sourcemap: false,
	dts: false,
	splitting: false, // Disable code splitting for single file output
});
