import { ContainerKind } from "./kinds";
import { Dashboard, LayoutNode, isContainer } from "./layout-tree";
import { specFor } from "./panels";
import { FieldValue } from "./schema";

/**
 * The layout tree back to YAML.
 *
 * Fields come from each panel's declaration rather than a hand-written list per
 * type, so a field cannot be added to a panel and forgotten here. That failure
 * was silent: the option simply vanished the next time anyone edited.
 */

/** Quotes only where YAML would otherwise misread the value. */
function scalar(v: FieldValue): string {
	if (typeof v !== "string") return String(v);

	if (v === "") return '""';

	const risky =
		/^\s|\s$/.test(v) ||
		/^(true|false|null|~|yes|no|on|off)$/i.test(v) ||
		/^[-+]?[\d.]+$/.test(v) ||
		/^\d{4}-\d{2}(-\d{2})?$/.test(v) ||
		/[:#{}[\],&*?|<>=!%@`"']/.test(v);

	return risky ? JSON.stringify(v) : v;
}

/** Every option a node carries, in a stable order. `id` is runtime only. */
function optionsOf(node: LayoutNode): [string, string][] {
	const out: [string, string][] = [];

	const put = (k: string, v: FieldValue | undefined) => {
		if (v !== undefined) out.push([k, scalar(v)]);
	};

	if (isContainer(node)) {
		put("gap", node.gap);

		if (node.type === ContainerKind.Row) put("wrap", node.wrap);
	} else {
		// SAFETY: reading a panel by its own declared field keys is what the
		// registry exists for; every key below comes from that panel's spec.
		const values = node as unknown as Record<string, FieldValue | undefined>;

		for (const field of specFor(node.type).fields) {
			const v = values[field.key];

			if (v === undefined) continue;
			out.push([field.key, Array.isArray(v) ? `[${v.map(scalar).join(", ")}]` : scalar(v)]);
		}
	}

	put("flex", node.flex);

	return out;
}

function writeNode(node: LayoutNode, indent: string, lines: string[]): void {
	lines.push(`${indent}- type: ${node.type}`);
	const inner = indent + "  ";

	for (const [k, v] of optionsOf(node)) lines.push(`${inner}${k}: ${v}`);


	if (isContainer(node)) writeChildren(node.children, inner, lines);
}

function writeChildren(children: LayoutNode[], indent: string, lines: string[]): void {
	// a bare `children:` reads back as null, so an empty container needs []
	if (children.length === 0) {
		lines.push(`${indent}children: []`);

		return;
	}

	lines.push(`${indent}children:`);

	for (const child of children) writeNode(child, `${indent}  `, lines);
}

export function serializeDashboard(dashboard: Dashboard): string {
	const lines: string[] = [`folder: ${scalar(dashboard.folder)}`, "layout:"];

	lines.push(`  type: ${dashboard.root.type}`);

	for (const [k, v] of optionsOf(dashboard.root)) lines.push(`  ${k}: ${v}`);
	writeChildren(dashboard.root.children, "  ", lines);

	return lines.join("\n") + "\n";
}
