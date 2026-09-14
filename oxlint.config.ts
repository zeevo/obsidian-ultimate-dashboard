import { defineConfig } from "oxlint";

export default defineConfig({
	ignorePatterns: [
		// the vendored ruleset lints itself under its own standards upstream
		"tools/oxlint/anti-slop/**",
		"tools/oxlint/house/**",
		"main.js",
		"test/*.mjs",
		"node_modules/**",
	],
	jsPlugins: [
		{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
		{ name: "house", specifier: "./tools/oxlint/house/index.ts" },
	],
	rules: {
		"oxc/no-accumulating-spread": "error",
		"house/no-enums": "error",
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
			 * google.ts parses JSON off the Calendar API, weather.ts parses JSON off
			 * Open-Meteo, and
			 * kinds, schema, widgets, serialize and widget-form sit on the seam where a
			 * typed widget meets its declared field list: reading a field by its declared
			 * key is the point of the registry, and it cannot be expressed without it.
			 * Every input arrives as `unknown` and has to be narrowed with `typeof`
			 * before it can become a domain type, which is exactly what these rules
			 * forbid. They stay on everywhere else so the narrowing cannot leak out.
			 */
			files: ["src/config.ts", "src/ics.ts", "src/data.ts", "src/kinds.ts", "src/schema.ts", "src/widgets.ts", "src/serialize.ts", "src/widget-form.ts", "src/layout-tree.ts"],
			rules: {
				"anti-slop/no-runtime-typeof": "off",
				"anti-slop/no-unknown-parameters": "off",
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-known-value-widening": "off",
				"anti-slop/require-safety-comment-for-type-assertion": "off",
				// viewing a typed widget as its own field bag needs `as unknown as`
				"anti-slop/no-chained-type-assertions": "off",
			},
		},
		{
			/*
			 * These parse their input with zod rather than by hand, so they need
			 * none of the narrowing exemptions above. What is left is only the
			 * entry point signature: something has to accept `unknown` from the
			 * network or from data.json before a schema can be run over it.
			 */
			files: ["src/weather.ts", "src/google.ts", "src/store.ts"],
			rules: {
				"anti-slop/no-unknown-parameters": "off",
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
