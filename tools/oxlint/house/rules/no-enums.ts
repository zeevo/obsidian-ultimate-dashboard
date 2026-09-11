import { defineRule } from "@oxlint/plugins";

/**
 * Ban TypeScript enums in favour of an `as const` object and a derived union.
 *
 * Enums are not erasable: they emit a runtime object, numeric enums allow any
 * number through the type check, and declaration merging lets them be extended
 * from anywhere. An `as const` object gives the same named constants and a
 * narrower type, and compiles away to plain strings.
 */
export const noEnumsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow TypeScript enums; use an `as const` object with a derived union type.",
		},
		messages: {
			noEnum:
				"Replace `enum {{name}}` with an `as const` object and a derived union:\n" +
				"  export const {{name}} = { Member: \"member\" } as const;\n" +
				"  export type {{name}} = (typeof {{name}})[keyof typeof {{name}}];",
		},
	},
	createOnce(context) {
		return {
			TSEnumDeclaration(node) {
				const name = node.id?.type === "Identifier" ? node.id.name : "TheEnum";

				context.report({ node, messageId: "noEnum", data: { name } });
			},
		};
	},
});
