import { ContainerNode, DashboardConfig, Node, Tile, isContainer } from "./config";

/**
 * Turns a layout tree back into the YAML the parser reads.
 *
 * The visual editor works on the tree and writes through this, so a dashboard
 * built by dragging is the same artefact as one typed by hand: both round trip
 * through `parseConfig`, and either editor can pick up where the other left off.
 */

/** Any value a node field can hold. */
type Scalar = string | number | boolean;

/** Quotes only where YAML would otherwise misread the value. */
function scalar(v: Scalar): string {
	// eslint-disable-next-line
	if (typeof v !== "string") return String(v);

	if (v === "") return '""';

	// leading/trailing space, or anything that could parse as another type
	const risky =
		/^[\s]|[\s]$/.test(v) ||
		/^(true|false|null|~|yes|no|on|off)$/i.test(v) ||
		/^[-+]?[\d.]+$/.test(v) ||
		/^\d{4}-\d{2}(-\d{2})?$/.test(v) ||
		/[:#{}[\],&*?|<>=!%@`"']/.test(v);

	return risky ? JSON.stringify(v) : v;
}

function inlineList(values: string[]): string {
	return `[${values.map((v) => scalar(v)).join(", ")}]`;
}

/** Key/value lines for a node, skipping anything left at its default. */
function fields(node: Node): [string, string][] {
	const out: [string, string][] = [];

	const put = (k: string, v: string | number | boolean | undefined) => {
		if (v === undefined) return;
		out.push([k, scalar(v)]);
	};

	if (isContainer(node)) {
		put("gap", node.gap);
		put("wrap", node.wrap);
	} else if (node.type === "stats") {
		// tiles are written separately, as a nested list
	} else if (node.type === "heatmap") {
		put("title", node.title);
		put("property", node.property);
		put("intensity", node.intensity);
		put("color", node.color);
		put("year", node.year);
		put("months", node.months);
		put("days", node.days);
		put("from", node.from);
		put("to", node.to);
	} else if (node.type === "line") {
		put("title", node.title);
		put("property", node.property);
		put("rolling", node.rolling);
		put("unit", node.unit);
		put("color", node.color);
		put("year", node.year);
		put("months", node.months);
		put("days", node.days);
		put("from", node.from);
		put("to", node.to);
	} else if (node.type === "upcoming") {
		put("title", node.title);
		put("days", node.days);
		put("limit", node.limit);
		put("past", node.past);
	} else {
		put("title", node.title);
		put("month", node.month);
		put("maxPerDay", node.maxPerDay);
		put("weekStart", node.weekStart);
	}

	if ("calendars" in node && node.calendars) {
		out.push(["calendars", inlineList(node.calendars)]);
	}

	put("flex", node.flex);

	return out;
}

function tileLine(tile: Tile): string {
	const parts: string[] = [];

	const put = (k: string, v: string | number | undefined) => {
		if (v !== undefined) parts.push(`${k}: ${scalar(v)}`);
	};

	put("label", tile.label);
	put("property", tile.property);
	put("agg", tile.agg);
	put("days", tile.days);
	put("target", tile.target);
	put("unit", tile.unit);
	put("precision", tile.precision);

	return `{ ${parts.join(", ")} }`;
}

function writeNode(node: Node, indent: string, lines: string[]): void {
	lines.push(`${indent}- type: ${node.type}`);
	const inner = indent + "  ";

	for (const [k, v] of fields(node)) lines.push(`${inner}${k}: ${v}`);

	if (node.type === "stats") {
		lines.push(`${inner}tiles:`);

		for (const tile of node.tiles) lines.push(`${inner}  - ${tileLine(tile)}`);
	}

	if (isContainer(node)) {
		// a bare `children:` reads back as null, so an empty container needs []
		if (node.children.length === 0) {
			lines.push(`${inner}children: []`);
		} else {
			lines.push(`${inner}children:`);

			for (const child of node.children) writeNode(child, `${inner}  `, lines);
		}
	}
}

/** The whole block, ready to store or hand to the text editor. */
export function serializeConfig(config: DashboardConfig): string {
	const lines: string[] = [`folder: ${scalar(config.folder)}`, "layout:"];
	const root: ContainerNode = config.root;

	lines.push(`  type: ${root.type}`);

	for (const [k, v] of fields(root)) lines.push(`  ${k}: ${v}`);

	if (root.children.length === 0) {
		lines.push("  children: []");
	} else {
		lines.push("  children:");

		for (const child of root.children) writeNode(child, "    ", lines);
	}

	return lines.join("\n") + "\n";
}
