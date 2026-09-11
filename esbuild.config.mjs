import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const production = process.argv[2] === "production";

/** Where to drop the built plugin. Set VAULT_PLUGIN_DIR to deploy on each build. */
const dest = process.env.VAULT_PLUGIN_DIR;

/** Copy the three files Obsidian actually loads into the vault. */
function deploy() {
	if (!dest) return;
	mkdirSync(dest, { recursive: true });

	for (const f of ["main.js", "manifest.json", "styles.css"]) {
		if (existsSync(f)) copyFileSync(f, join(dest, f));
	}

	// Marker file read by the Hot Reload plugin, if installed.
	writeFileSync(join(dest, ".hotreload"), "");
	console.log(`deployed -> ${dest}`);
}

const deployPlugin = {
	name: "deploy",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length === 0) deploy();
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", ...builtins],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	minify: production,
	outfile: "main.js",
	plugins: [deployPlugin],
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
	console.log("watching for changes; edit src/ and Obsidian will pick it up");
}
