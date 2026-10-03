import { WidgetKind } from "../kinds";
import { Field } from "../schema";
import { DayRecord } from "../data";
import { WeatherMode, WeatherUnit } from "../weather";
import { WidgetHost } from "./host";

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

export interface Ranged {
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
	/** Count a day only when `property` is a number under this, such as a calorie goal. */
	below?: number;
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

/* ------------------------------------------------------------- the spec */

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
	/** Draws the widget into its own element. */
	render(el: HTMLElement, widget: P, ctx: RenderContext): void;
}

/** What a widget may use while drawing. */
export interface RenderContext {
	/** Every daily note, oldest first. */
	days: DayRecord[];
	/** Draws an error inside `el`, for a widget that cannot show its content. */
	error(el: HTMLElement, message: string): void;
	/** The live plugin. Absent under the test harness. */
	host?: WidgetHost;
}
