import { eslintCompatPlugin } from "@oxlint/plugins";

import { noEnumsRule } from "./rules/no-enums.ts";

/** House rules for this repository, alongside the vendored anti-slop set. */
const housePlugin = eslintCompatPlugin({
	meta: { name: "house" },
	rules: {
		"no-enums": noEnumsRule,
	},
});

export default housePlugin;
