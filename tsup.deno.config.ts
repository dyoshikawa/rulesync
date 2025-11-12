import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli/index.ts"],
	format: ["cjs"],
	outDir: "dist",
	clean: true,
	minify: true,
	bundle: true,
	// Bundle all dependencies except xsschema's optional peer dependencies
	noExternal: [
		/^(?!@valibot\/to-json-schema|effect|sury).*/,
	],
	external: [
		// xsschema optional dependencies that are not needed at runtime
		"@valibot/to-json-schema",
		"effect",
		"sury",
	],
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
