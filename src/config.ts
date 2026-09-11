import { parseYaml } from "obsidian";

export type Agg = "latest" | "mean" | "count" | "sum" | "delta";

/** Shared by every node, container or leaf. */
interface NodeBase {
	/** Growth factor within its container. */
	flex?: number;
}

/** A date window, shared by any panel that plots over time. */
export interface RangeOptions {
	/** A whole calendar year. The default is the current year. */
	year?: number;
	/** Trailing window ending today. */
	months?: number;
	/** Trailing window ending today. */
	days?: number;
	/** Explicit window. `from` alone runs to today; `to` alone runs from the first entry. */
	from?: string;
	to?: string;
}

export interface Tile {
	label: string;
	property: string;
	agg: Agg;
	/** Rolling window in days. Omit to use the whole history. */
	days?: number;
	/** Shown as `value / target`. */
	target?: number;
	unit?: string;
	/** Decimal places. Defaults to 1 for numeric aggs, 0 for counts. */
	precision?: number;
}

export interface StatsPanel extends NodeBase {
	type: "stats";
	tiles: Tile[];
}

export interface HeatmapPanel extends NodeBase, RangeOptions {
	type: "heatmap";
	title?: string;
	property: string;
	color?: string;
	/** Numeric property used to shade each box. Omit for on/off shading. */
	intensity?: string;
}

export interface LinePanel extends NodeBase, RangeOptions {
	type: "line";
	title?: string;
	property: string;
	/** Rolling average window in days. Distinct from `days`, which sets the range. */
	rolling?: number;
	color?: string;
	unit?: string;
}

/** Shared by the panels that read calendar sources. */
interface CalendarBase extends NodeBase {
	title?: string;
	/** Calendar names to include. Omit for every configured calendar. */
	calendars?: string[];
}

/** An agenda list of what is coming up. */
export interface UpcomingPanel extends CalendarBase {
	type: "upcoming";
	/** How many days ahead to show. */
	days?: number;
	/** Cap on the number of events listed. */
	limit?: number;
	/** Include events already started today. Defaults to false. */
	past?: boolean;
}

/** A month grid, like a wall calendar. */
export interface MonthPanel extends CalendarBase {
	type: "calendar";
	/** The month to open on, as YYYY-MM. Defaults to the current month. */
	month?: string;
	/** Events shown per day before collapsing into a "+N more" line. */
	maxPerDay?: number;
	/** 0 for Sunday, 1 for Monday. Defaults to Sunday. */
	weekStart?: number;
}

export type CalendarPanel = UpcomingPanel | MonthPanel;

export type Panel = StatsPanel | HeatmapPanel | LinePanel | UpcomingPanel | MonthPanel;

export type ContainerKind = "row" | "column";

export interface ContainerNode extends NodeBase {
	type: ContainerKind;
	children: Node[];
	/** Space between children, in pixels. Inherited from the parent if unset. */
	gap?: number;
	/** Row only: whether children wrap onto further lines. Defaults to true. */
	wrap?: boolean;
}

export type Node = ContainerNode | Panel;

export interface DashboardConfig {
	folder: string;
	/** The layout tree. Always a container, even when built from `panels`. */
	root: ContainerNode;
}

export class ConfigError extends Error {}

const AGGS: Agg[] = ["latest", "mean", "count", "sum", "delta"];

const CONTAINERS: ContainerKind[] = ["row", "column"];

const LEAVES = ["stats", "heatmap", "line", "upcoming", "calendar"];

const MAX_DEPTH = 8;

function str(v: unknown, field: string): string {
	if (typeof v !== "string" || v.trim() === "") {
		throw new ConfigError(`\`${field}\` must be a non-empty string`);
	}

	return v.trim();
}

function optNum(v: unknown, field: string): number | undefined {
	if (v === undefined || v === null) return undefined;

	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new ConfigError(`\`${field}\` must be a number`);
	}

	return v;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optDate(v: unknown, field: string): string | undefined {
	if (v === undefined || v === null) return undefined;

	// YAML turns an unquoted 2026-01-01 into a Date, so accept both forms.
	const iso =
		v instanceof Date
			? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
			: String(v).trim();

	if (!ISO_DATE.test(iso)) {
		throw new ConfigError(`\`${field}\` must be a date like 2026-01-31`);
	}

	return iso;
}

function parseRange(p: Record<string, unknown>, where: string): RangeOptions {
	const year = optNum(p.year, `${where} year`);
	const months = optNum(p.months, `${where} months`);
	const days = optNum(p.days, `${where} days`);
	const from = optDate(p.from, `${where} from`);
	const to = optDate(p.to, `${where} to`);

	const given = [
		year !== undefined && "year",
		months !== undefined && "months",
		days !== undefined && "days",
		(from ?? to) !== undefined && "from/to",
	].filter(Boolean) as string[];

	if (given.length > 1) {
		throw new ConfigError(`${where}: pick one range only, got ${given.join(" and ")}`);
	}

	for (const [name, v] of [["months", months], ["days", days]] as [string, number | undefined][]) {
		if (v !== undefined && (!Number.isInteger(v) || v < 1)) {
			throw new ConfigError(`${where}: \`${name}\` must be a positive whole number`);
		}
	}

	if (from && to && from > to) {
		throw new ConfigError(`${where}: \`from\` (${from}) is after \`to\` (${to})`);
	}

	return { year, months, days, from, to };
}

function parseTile(raw: unknown, i: number, where: string): Tile {
	if (typeof raw !== "object" || raw === null) {
		throw new ConfigError(`${where} tile ${i + 1} must be a mapping`);
	}

	const t = raw as Record<string, unknown>;
	const agg = (t.agg ?? "latest") as Agg;

	if (!AGGS.includes(agg)) {
		throw new ConfigError(
			`${where} tile ${i + 1}: unknown agg "${String(t.agg)}", expected one of ${AGGS.join(", ")}`,
		);
	}

	return {
		label: str(t.label, `${where} tile ${i + 1} label`),
		property: str(t.property, `${where} tile ${i + 1} property`),
		agg,
		days: optNum(t.days, `${where} tile ${i + 1} days`),
		target: optNum(t.target, `${where} tile ${i + 1} target`),
		precision: optNum(t.precision, `${where} tile ${i + 1} precision`),
		unit: typeof t.unit === "string" ? t.unit : undefined,
	};
}

/** What kind of container a node sits directly inside. */
interface Parent {
	kind: ContainerKind;
}

function parseSizing(p: Record<string, unknown>, where: string): NodeBase {
	if (p.span !== undefined) {
		throw new ConfigError(
			`${where}: \`span\` is gone. Size children with \`flex\` inside a row or column.`,
		);
	}

	if (p.flex === undefined || p.flex === null) return {};
	const f = optNum(p.flex, `${where} flex`)!;

	if (f <= 0) throw new ConfigError(`${where}: \`flex\` must be greater than zero`);

	return { flex: f };
}

function parseNode(raw: unknown, where: string, parent: Parent, depth: number): Node {
	if (depth > MAX_DEPTH) {
		throw new ConfigError(`${where}: layout nested deeper than ${MAX_DEPTH} levels`);
	}

	if (typeof raw !== "object" || raw === null) {
		throw new ConfigError(`${where} must be a mapping`);
	}

	const p = raw as Record<string, unknown>;
	const type = str(p.type, `${where} type`);
	const sizing = parseSizing(p, where);

	if (CONTAINERS.includes(type as ContainerKind)) {
		const kind = type as ContainerKind;

		// An empty list is allowed: the visual editor creates a divider before you
		// fill it. A missing key is still an error, since that is a typo.
		if (!Array.isArray(p.children)) {
			throw new ConfigError(`${where}: \`${kind}\` needs a \`children\` list`);
		}

		if (p.columns !== undefined || p.minWidth !== undefined) {
			throw new ConfigError(
				`${where}: \`columns\` and \`minWidth\` are gone. Build columns with a row of children.`,
			);
		}

		if (kind !== "row" && p.wrap !== undefined) {
			throw new ConfigError(`${where}: \`wrap\` only applies to a row`);
		}

		const childParent: Parent = { kind };

		return {
			type: kind,
			...sizing,
			gap: optNum(p.gap, `${where} gap`),
			wrap: typeof p.wrap === "boolean" ? p.wrap : undefined,
			children: p.children.map((c, i) =>
				parseNode(c, `${where} > ${kind}[${i}]`, childParent, depth + 1),
			),
		};
	}

	if (p.children !== undefined) {
		throw new ConfigError(
			`${where}: \`${type}\` is a panel and cannot have \`children\`. ` +
				`Wrap panels in a row or column instead.`,
		);
	}

	if (type === "stats") {
		if (!Array.isArray(p.tiles) || p.tiles.length === 0) {
			throw new ConfigError(`${where}: stats needs a non-empty \`tiles\` list`);
		}

		return { type: "stats", ...sizing, tiles: p.tiles.map((t, i) => parseTile(t, i, where)) };
	}

	if (type === "heatmap") {
		return {
			type: "heatmap",
			...sizing,
			...parseRange(p, where),
			title: typeof p.title === "string" ? p.title : undefined,
			property: str(p.property, `${where} property`),
			color: typeof p.color === "string" ? p.color : undefined,
			intensity: typeof p.intensity === "string" ? p.intensity : undefined,
		};
	}

	if (type === "line") {
		return {
			type: "line",
			...sizing,
			...parseRange(p, where),
			title: typeof p.title === "string" ? p.title : undefined,
			property: str(p.property, `${where} property`),
			rolling: optNum(p.rolling, `${where} rolling`),
			color: typeof p.color === "string" ? p.color : undefined,
			unit: typeof p.unit === "string" ? p.unit : undefined,
		};
	}

	if (type === "upcoming" || type === "calendar") {
		let calendars: string[] | undefined;

		if (p.calendars !== undefined && p.calendars !== null) {
			if (!Array.isArray(p.calendars) || p.calendars.some((c) => typeof c !== "string")) {
				throw new ConfigError(`${where}: \`calendars\` must be a list of calendar names`);
			}

			calendars = (p.calendars as string[]).map((c) => c.trim()).filter(Boolean);
		}

		const common = {
			...sizing,
			title: typeof p.title === "string" ? p.title : undefined,
			calendars,
		};

		if (type === "calendar") {
			const month = typeof p.month === "string" ? p.month.trim() : undefined;

			if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
				throw new ConfigError(`${where}: \`month\` must look like 2026-09`);
			}

			const maxPerDay = optNum(p.maxPerDay, `${where} maxPerDay`);

			if (maxPerDay !== undefined && (!Number.isInteger(maxPerDay) || maxPerDay < 1)) {
				throw new ConfigError(`${where}: \`maxPerDay\` must be a positive whole number`);
			}

			const weekStart = optNum(p.weekStart, `${where} weekStart`);

			if (weekStart !== undefined && weekStart !== 0 && weekStart !== 1) {
				throw new ConfigError(`${where}: \`weekStart\` must be 0 for Sunday or 1 for Monday`);
			}

			return { type: "calendar", ...common, month, maxPerDay, weekStart };
		}

		const rangeDays = optNum(p.days, `${where} days`);

		if (rangeDays !== undefined && (!Number.isInteger(rangeDays) || rangeDays < 1)) {
			throw new ConfigError(`${where}: \`days\` must be a positive whole number`);
		}

		const limit = optNum(p.limit, `${where} limit`);

		if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
			throw new ConfigError(`${where}: \`limit\` must be a positive whole number`);
		}

		return {
			type: "upcoming",
			...common,
			days: rangeDays,
			limit,
			past: typeof p.past === "boolean" ? p.past : undefined,
		};
	}

	throw new ConfigError(
		`${where}: unknown type "${type}", expected one of ${[...LEAVES, ...CONTAINERS].join(", ")}`,
	);
}

export function isContainer(node: Node): node is ContainerNode {
	return CONTAINERS.includes(node.type as ContainerKind);
}

export function parseConfig(source: string): DashboardConfig {
	let raw: unknown;

	try {
		raw = parseYaml(source);
	} catch (e) {
		throw new ConfigError(`could not parse YAML: ${(e as Error).message}`);
	}

	if (typeof raw !== "object" || raw === null) {
		throw new ConfigError("the block is empty");
	}

	const c = raw as Record<string, unknown>;
	const folder = typeof c.folder === "string" ? c.folder : "Daily";

	if (c.layout !== undefined && c.panels !== undefined) {
		throw new ConfigError("use either `layout` or `panels`, not both");
	}

	// Tree form.
	if (c.layout !== undefined) {
		const root = parseNode(c.layout, "layout", { kind: "column" }, 0);

		if (!isContainer(root)) {
			throw new ConfigError(
				`layout: the root must be a row or column, not a "${root.type}" panel`,
			);
		}

		return { folder, root };
	}

	// Flat form, kept so older blocks keep working: a grid of panels.
	if (!Array.isArray(c.panels) || c.panels.length === 0) {
		throw new ConfigError("`panels` must be a non-empty list, or use `layout`");
	}

	const parent: Parent = { kind: "column" };

	return {
		folder,
		root: {
			type: "column",
			gap: optNum(c.gap, "gap") ?? 20,
			children: c.panels.map((p, i) => parseNode(p, `panel[${i}]`, parent, 1)),
		},
	};
}

/** How many leaf panels a tree contains. */
export function countPanels(node: Node): number {
	return isContainer(node) ? node.children.reduce((n, c) => n + countPanels(c), 0) : 1;
}
