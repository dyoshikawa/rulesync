import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Deno requires "node:" prefix for Node.js built-in modules
const nodeBuiltins = [
	"assert",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"dns",
	"domain",
	"events",
	"fs",
	"http",
	"https",
	"module",
	"net",
	"os",
	"path",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"sys",
	"timers",
	"tls",
	"tty",
	"url",
	"util",
	"vm",
	"zlib",
	"process",
	"fs/promises",
];

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
	async onSuccess() {
		// Add "node:" prefix to Node.js built-in modules after bundling
		const outFile = join(process.cwd(), "dist", "index.cjs");
		let content = readFileSync(outFile, "utf-8");

		// Replace require() calls with node: prefix for built-in modules
		for (const builtin of nodeBuiltins) {
			const escapedBuiltin = builtin.replace(/\//g, "\\/");

			// Match: require('builtin'), require("builtin")
			const requireRegex = new RegExp(
				`require\\s*\\(\\s*(['"])${escapedBuiltin}\\1\\s*\\)`,
				"g",
			);
			content = content.replace(requireRegex, `require($1node:${builtin}$1)`);
		}

		writeFileSync(outFile, content, "utf-8");
		// Use process.stderr to avoid oxlint error
		process.stderr.write("✓ Added node: prefix to built-in modules in CJS bundle\n");
	},
});
