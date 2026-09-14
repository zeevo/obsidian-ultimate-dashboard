import { WidgetKind } from "./kinds";
import { Field, FieldKind } from "./schema";
import { WEATHER_UNITS, WeatherMode, WeatherUnit } from "./weather";

/**
 * The widget registry.
 *
 * Every widget type is declared here once: its fields, its label, and how it
 * draws. Parsing, serialising, the configuration form and the editor palette
 * are all derived from these declarations, so adding a type is one entry rather
 * than edits scattered across six files.
 */

/** Sizing and identity every node carries, whatever its kind. */
export interface NodeBase {
	/** Assigned at parse time, never serialised. Stable across re-renders. */
	id: string;
	/** Growth factor within its container. */
	flex?: number;
}

export const Agg = {
	Latest: "latest",
	Mean: "mean",
	Sum: "sum",
	Count: "count",
	Delta: "delta",
} as const;

export type Agg = (typeof Agg)[keyof typeof Agg];

export const AGGS = Object.values(Agg);

export function toAgg(v: unknown): Agg | null {
	return AGGS.find((a) => a === v) ?? null;
}

/* -------------------------------------------------------------- the widgets */

export interface StatWidget extends NodeBase {
	type: typeof WidgetKind.Stat;
	/** Caption. Defaults to the property name. */
	label?: string;
	property: string;
	agg?: Agg;
	/** Rolling window, in days back from today. Omit for the whole history. */
	back?: number;
	/** Shown as `value / target`. */
	target?: number;
	unit?: string;
	precision?: number;
}

interface Ranged {
	year?: number;
	months?: number;
	back?: number;
	from?: string;
	to?: string;
}

export interface LineWidget extends NodeBase, Ranged {
	type: typeof WidgetKind.Line;
	title?: string;
	property: string;
	rolling?: number;
	unit?: string;
	color?: string;
}

export interface HeatmapWidget extends NodeBase, Ranged {
	type: typeof WidgetKind.Heatmap;
	title?: string;
	property: string;
	intensity?: string;
	color?: string;
	/** Show how many days in a row are filled in, counting back from today. */
	streak?: boolean;
}

export interface UpcomingWidget extends NodeBase {
	type: typeof WidgetKind.Upcoming;
	title?: string;
	calendars?: readonly string[];
	/** How far ahead to look. Named to avoid colliding with `back`, which looks the other way. */
	ahead?: number;
	limit?: number;
	past?: boolean;
}

export interface CalendarWidget extends NodeBase {
	type: typeof WidgetKind.Calendar;
	title?: string;
	calendars?: readonly string[];
	month?: string;
	maxPerDay?: number;
	weekStart?: number;
}

export interface NoteWidget extends NodeBase {
	type: typeof WidgetKind.Note;
	/** Caption. Defaults to the note's own path. */
	title?: string;
	/** A link path, written the way you would inside `[[ ]]`. */
	path: string;
	/** Visible height before the tile scrolls, in pixels. */
	height?: number;
}

export interface BlankWidget extends NodeBase {
	type: typeof WidgetKind.Blank;
	/** How tall the placeholder stands, in pixels. */
	height?: number;
}

export interface WeatherWidget extends NodeBase {
	type: typeof WidgetKind.Weather;
	/** Caption. Defaults to the place the forecast resolved to. */
	title?: string;
	/** A place name, resolved to coordinates once and remembered. */
	place: string;
	/** What the tile shows. Defaults to today alone. */
	mode?: WeatherMode;
	units?: WeatherUnit;
	/**
	 * The current conditions headline. On by default, and worth turning off in
	 * `hourly`, where the first column already covers now.
	 */
	current?: boolean;
	wind?: boolean;
	humidity?: boolean;
	/** Today's sunrise and sunset. */
	sun?: boolean;
}

export interface ClockWidget extends NodeBase {
	type: typeof WidgetKind.Clock;
	title?: string;
	/** Tick the seconds. Off by default, since it costs a redraw a second. */
	seconds?: boolean;
	/** Today's date under the time. */
	date?: boolean;
	hour24?: boolean;
	/** Draw a face instead of digits. A face is always twelve hour. */
	analog?: boolean;
}

export type Widget =
	| StatWidget
	| LineWidget
	| HeatmapWidget
	| UpcomingWidget
	| CalendarWidget
	| NoteWidget
	| BlankWidget
	| WeatherWidget
	| ClockWidget;

/* ------------------------------------------------------------ field groups */

/**
 * A date window, shared by the widgets that plot over time. `back` looks
 * backwards from today; `ahead` on an agenda looks forwards. They used to share
 * the name `days`, which meant opposite things on different widgets.
 */
const RANGE_FIELDS: readonly Field<Ranged>[] = [
	{ key: "year", kind: FieldKind.Number, label: "Year", min: 1970 },
	{ key: "months", kind: FieldKind.Number, label: "Months back" },
	{ key: "back", kind: FieldKind.Number, label: "Days back" },
	{ key: "from", kind: FieldKind.Date, label: "From" },
	{ key: "to", kind: FieldKind.Date, label: "To" },
];

export const RANGE_KEYS = ["year", "months", "back", "from", "to"] as const;

/* ---------------------------------------------------------------- registry */

/**
 * A new widget of this type, before the tree assigns it an id. Written as a
 * conditional so it distributes over the union rather than collapsing to the
 * keys every widget shares.
 */
export type NewWidget<P extends Widget = Widget> = P extends Widget ? Omit<P, "id"> : never;

export interface WidgetSpec<P extends Widget = Widget> {
	readonly type: P["type"];
	readonly label: string;
	readonly hint: string;
	readonly fields: readonly Field<P>[];
	/**
	 * What dropping this type onto the canvas creates. Required fields start
	 * empty, so a fresh widget reads as needing setup and opens its form.
	 */
	blank(): NewWidget<P>;
	/**
	 * What the widget calls itself. Declared once so the heading it draws and
	 * the placeholder in its form cannot disagree, and so leaving the title
	 * empty never produces a blank heading.
	 */
	title(widget: P): string;
	/** A one line summary for the editor's card. */
	summary(widget: P): string;
	/**
	 * Rules spanning more than one field, which a per-field schema cannot see.
	 * Returns a message, or null when the widget is coherent.
	 */
	validate?(widget: P): string | null;
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/** "2026-02" as "February 2026", or the current month when unset. */
function monthName(month?: string): string {
	const date = month
		? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
		: new Date();

	return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The last segment of a vault path, without the extension. */
function basename(path: string): string {
	return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

/** Ranges are mutually exclusive, and a window must run forwards. */
function validateRange(widget: Ranged): string | null {
	const set = RANGE_KEYS.filter(
		(k) => k !== "to" && widget[k as keyof Ranged] !== undefined,
	);

	const named = set.map((k) => (k === "from" ? "from/to" : k));

	if (named.length > 1) return `pick one range only, got ${named.join(" and ")}`;

	if (widget.from && widget.to && widget.from > widget.to) {
		return `\`from\` (${widget.from}) is after \`to\` (${widget.to})`;
	}

	return null;
}

const stat: WidgetSpec<StatWidget> = {
	type: WidgetKind.Stat,
	label: "Stat",
	hint: "One number",
	fields: [
		{ key: "label", kind: FieldKind.Text, label: "Caption" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{
			key: "agg",
			kind: FieldKind.Choice,
			label: "Aggregate",
			choices: AGGS.map((a) => ({ value: a, label: a })),
		},
		{ key: "back", kind: FieldKind.Number, label: "Days back" },
		{ key: "target", kind: FieldKind.Number, label: "Target" },
		{ key: "unit", kind: FieldKind.Text, label: "Unit", placeholder: "lb" },
		{ key: "precision", kind: FieldKind.Number, label: "Decimal places", min: 0 },
	],
	blank: () => ({ type: WidgetKind.Stat, property: "" }),
	title: (w) => w.label || w.property || "Stat",
	summary: (p) => (p.property ? `${p.agg ?? Agg.Latest} of ${p.property}` : "not configured"),
};

const line: WidgetSpec<LineWidget> = {
	type: WidgetKind.Line,
	label: "Line chart",
	hint: "A value over time",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{ key: "rolling", kind: FieldKind.Number, label: "Rolling average (days)" },
		{ key: "unit", kind: FieldKind.Text, label: "Unit", placeholder: "lb" },
		{ key: "color", kind: FieldKind.Colour, label: "Color", placeholder: "#3b82f6" },
		...RANGE_FIELDS,
	],
	blank: () => ({ type: WidgetKind.Line, property: "" }),
	title: (w) => w.title || w.property || "Line chart",
	summary: (p) => p.property || "not configured",
	validate: validateRange,
};

const heatmap: WidgetSpec<HeatmapWidget> = {
	type: WidgetKind.Heatmap,
	label: "Heatmap",
	hint: "A year of activity",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{ key: "intensity", kind: FieldKind.Property, label: "Shade by", hint: "Numeric property" },
		{ key: "color", kind: FieldKind.Colour, label: "Color", placeholder: "#3b82f6" },
		{
			key: "streak",
			kind: FieldKind.Toggle,
			label: "Show current streak",
			hint: "Days in a row, counting back from today",
		},
		...RANGE_FIELDS,
	],
	blank: () => ({ type: WidgetKind.Heatmap, property: "" }),
	title: (w) => w.title || w.property || "Heatmap",
	summary: (p) => p.property || "not configured",
	validate: validateRange,
};

const upcoming: WidgetSpec<UpcomingWidget> = {
	type: WidgetKind.Upcoming,
	label: "Upcoming",
	hint: "Agenda list",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "calendars", kind: FieldKind.Calendars, label: "Calendars" },
		{ key: "ahead", kind: FieldKind.Number, label: "Days ahead" },
		{ key: "limit", kind: FieldKind.Number, label: "Most events" },
		{ key: "past", kind: FieldKind.Toggle, label: "Include today's finished events" },
	],
	blank: () => ({ type: WidgetKind.Upcoming }),
	title: (w) => w.title || "Upcoming",
	summary: (p) => `${p.ahead ?? 14} days`,
};

const calendar: WidgetSpec<CalendarWidget> = {
	type: WidgetKind.Calendar,
	label: "Month",
	hint: "Month grid",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "calendars", kind: FieldKind.Calendars, label: "Calendars" },
		{ key: "month", kind: FieldKind.Month, label: "Month" },
		{ key: "maxPerDay", kind: FieldKind.Number, label: "Events per day" },
		{
			key: "weekStart",
			kind: FieldKind.Choice,
			label: "Week starts",
			choices: [
				{ value: "0", label: "Sunday" },
				{ value: "1", label: "Monday" },
			],
		},
	],
	blank: () => ({ type: WidgetKind.Calendar }),
	title: (w) => w.title || monthName(w.month),
	summary: (p) => p.month ?? "this month",
};

const note: WidgetSpec<NoteWidget> = {
	type: WidgetKind.Note,
	label: "Note",
	hint: "Another note, embedded",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{
			key: "path",
			kind: FieldKind.Note,
			label: "Note",
			required: true,
			placeholder: "0 All/Health.md",
		},
		{ key: "height", kind: FieldKind.Number, label: "Height (px)", min: 60 },
	],
	blank: () => ({ type: WidgetKind.Note, path: "" }),
	title: (w) => w.title || basename(w.path) || "Note",
	summary: (p) => p.path || "not configured",
};

const blankWidget: WidgetSpec<BlankWidget> = {
	type: WidgetKind.Blank,
	label: "Blank",
	hint: "A placeholder that holds space",
	fields: [{ key: "height", kind: FieldKind.Number, label: "Height (px)" }],
	blank: () => ({ type: WidgetKind.Blank }),
	title: () => "Blank",
	summary: () => "placeholder",
};

const weather: WidgetSpec<WeatherWidget> = {
	type: WidgetKind.Weather,
	label: "Weather",
	hint: "Current conditions and forecast",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{
			key: "place",
			kind: FieldKind.Text,
			label: "Place",
			required: true,
			placeholder: "Denver",
		},
		{
			key: "mode",
			kind: FieldKind.Choice,
			label: "Forecast",
			choices: [
				{ value: WeatherMode.Today, label: "Today" },
				{ value: WeatherMode.ThreeDay, label: "Next 3 days" },
				{ value: WeatherMode.Hourly, label: "Next 12 hours" },
				{ value: WeatherMode.Weekly, label: "Next 7 days" },
			],
		},
		{
			key: "units",
			kind: FieldKind.Choice,
			label: "Units",
			choices: WEATHER_UNITS.map((u) => ({ value: u, label: u === "celsius" ? "Celsius" : "Fahrenheit" })),
		},
		{
			key: "current",
			kind: FieldKind.Toggle,
			label: "Show current conditions",
			hint: "On unless set. The hourly forecast already opens on the current hour",
		},
		{ key: "wind", kind: FieldKind.Toggle, label: "Show wind" },
		{ key: "humidity", kind: FieldKind.Toggle, label: "Show humidity" },
		{ key: "sun", kind: FieldKind.Toggle, label: "Show sunrise and sunset" },
	],
	blank: () => ({ type: WidgetKind.Weather, place: "" }),
	title: (w) => w.title || "Weather",
	summary: (w) => w.place || "not configured",
};

const clock: WidgetSpec<ClockWidget> = {
	type: WidgetKind.Clock,
	label: "Clock",
	hint: "The time, ticking",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "analog", kind: FieldKind.Toggle, label: "Analog face" },
		{ key: "seconds", kind: FieldKind.Toggle, label: "Show seconds" },
		{ key: "date", kind: FieldKind.Toggle, label: "Show the date" },
		{
			key: "hour24",
			kind: FieldKind.Toggle,
			label: "24 hour clock",
			hint: "Digital only. A face is always twelve hour",
		},
	],
	blank: () => ({ type: WidgetKind.Clock }),
	title: (w) => w.title || "Clock",
	summary: (w) => (w.analog ? "analog" : w.hour24 ? "24 hour" : "12 hour"),
};

/** Every widget type, keyed by its discriminant. */
export const WIDGETS: { readonly [K in WidgetKind]: WidgetSpec } = {
	[WidgetKind.Stat]: stat as WidgetSpec,
	[WidgetKind.Line]: line as WidgetSpec,
	[WidgetKind.Heatmap]: heatmap as WidgetSpec,
	[WidgetKind.Upcoming]: upcoming as WidgetSpec,
	[WidgetKind.Calendar]: calendar as WidgetSpec,
	[WidgetKind.Note]: note as WidgetSpec,
	[WidgetKind.Blank]: blankWidget as WidgetSpec,
	[WidgetKind.Weather]: weather as WidgetSpec,
	[WidgetKind.Clock]: clock as WidgetSpec,
};

export function specFor(type: WidgetKind): WidgetSpec {
	return WIDGETS[type];
}

