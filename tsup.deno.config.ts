import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli/index.ts"],
	format: ["cjs"],
	outDir: "dist",
	clean: true,
	minify: true,
	bundle: true,
	noExternal: [/.*/], // Bundle all dependencies
	platform: "node",
	target: "node22",
	treeshake: true,
	splitting: false,
	sourcemap: true,
	dts: false,
	shims: false,
	outExtension() {
		return {
			js: ".cjs",
		};
	},
});
