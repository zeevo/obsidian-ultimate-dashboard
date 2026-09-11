import { defineConfig } from "oxlint";

export default defineConfig({
	ignorePatterns: [
		// the vendored ruleset lints itself under its own standards upstream
		"tools/oxlint/anti-slop/**",
		"main.js",
		"test/*.mjs",
		"node_modules/**",
	],
	jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
	rules: {
		"oxc/no-accumulating-spread": "error",
		"anti-slop/no-array-filter-map": "error",
		"anti-slop/no-reduce-accumulator-copy": "error",
		"anti-slop/no-chained-type-assertions": "error",
		"anti-slop/no-conditional-empty-object-spread": "error",
		"anti-slop/no-known-value-widening": "error",
		"anti-slop/no-module-mocking": "error",
		"anti-slop/no-object-parameters": "error",
		"anti-slop/no-reflect-apply": "error",
		"anti-slop/no-reflect-get": "error",
		"anti-slop/no-runtime-typeof": "error",
		"anti-slop/no-shape-in-symbol-names": "error",
		"anti-slop/no-unknown-parameters": "error",
		"anti-slop/no-unknown-returns": "error",
		"anti-slop/no-unknown-type-aliases": "error",
		"anti-slop/no-unsafe-dictionary-type": "error",
		"anti-slop/no-widen-then-assert": "error",
		"anti-slop/require-readable-spacing": "error",
		"anti-slop/require-safety-comment-for-type-assertion": "error",
	},
	overrides: [
		{
			/*
			 * These three files are the I/O boundary anti-slop asks the rest of the
			 * codebase to rely on: config.ts parses YAML from the settings editor,
			 * store.ts parses data.json, ics.ts parses a downloaded calendar feed,
			 * data.ts parses note frontmatter out of the metadata cache, and
			 * google.ts parses JSON off the Calendar API.
			 * Every input arrives as `unknown` and has to be narrowed with `typeof`
			 * before it can become a domain type, which is exactly what these rules
			 * forbid. They stay on everywhere else so the narrowing cannot leak out.
			 */
			files: ["src/config.ts", "src/store.ts", "src/ics.ts", "src/data.ts", "src/google.ts"],
			rules: {
				"anti-slop/no-runtime-typeof": "off",
				"anti-slop/no-unknown-parameters": "off",
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-known-value-widening": "off",
				"anti-slop/require-safety-comment-for-type-assertion": "off",
			},
		},
		{
			// The harness deliberately fakes Obsidian's DOM and module surface.
			files: ["test/**"],
			rules: {
				"anti-slop/no-runtime-typeof": "off",
				"anti-slop/no-unknown-parameters": "off",
				"anti-slop/no-unknown-returns": "off",
				"anti-slop/no-unknown-type-aliases": "off",
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-known-value-widening": "off",
				"anti-slop/no-chained-type-assertions": "off",
				"anti-slop/require-safety-comment-for-type-assertion": "off",
			},
		},
	],
});
