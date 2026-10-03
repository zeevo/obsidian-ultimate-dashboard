import { DayRecord, num, truthy } from "../data";
import { MONTHS_SHORT, daysBetween, shiftDate, toISO, today } from "../dates";
import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { RANGE_FIELDS, resolveWindow, validateRange } from "./range";
import { HeatmapWidget, WidgetSpec } from "./types";

const DEFAULT_COLOR = "#3b82f6";

/** `#rrggbb` to an rgba() string at the given alpha. Falls back to the default. */
function shade(hex: string, alpha: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	const h = m ? m[1] : DEFAULT_COLOR.slice(1);
	const n = parseInt(h, 16);

	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Whether a day counts as filled in: the same test the boxes are shaded by. */
function logged(day: DayRecord, widget: HeatmapWidget): boolean {
	if (widget.below !== undefined) {
		const v = num(day, widget.property);

		return v !== null && v < widget.below;
	}

	if (truthy(day, widget.property)) return true;

	return widget.intensity !== undefined && num(day, widget.intensity) !== null;
}

/**
 * How many days in a row are filled in, counting back from today.
 *
 * Today not being logged yet does not break the run: the count then ends
 * yesterday, so a streak does not read zero every morning until you write the
 * day up. The window the heatmap draws is ignored, since a six month view
 * should not report a two hundred day streak as one hundred and eighty.
 */
export function currentStreak(days: DayRecord[], widget: HeatmapWidget): number {
	const filled = new Set<string>();

	for (const day of days) {
		if (logged(day, widget)) filled.add(day.date);
	}

	const now = today();
	let cursor = filled.has(now) ? now : shiftDate(now, -1);
	let run = 0;

	while (filled.has(cursor)) {
		run += 1;
		cursor = shiftDate(cursor, -1);
	}

	return run;
}

export function renderHeatmap(el: HTMLElement, days: DayRecord[], widget: HeatmapWidget): void {
	const color = widget.color ?? DEFAULT_COLOR;
	const { start, end } = resolveWindow(widget, days, "year");

	const values = new Map<string, number>();

	for (const day of days) {
		if (day.date < start || day.date > end) continue;

		if (!logged(day, widget)) continue;

		values.set(day.date, widget.intensity ? (num(day, widget.intensity) ?? 1) : 1);
	}

	// Scale to the 90th percentile, not the max: one unusually long ride would
	// otherwise push every ordinary day into the palest bucket.
	const sorted = [...values.values()].sort((a, b) => a - b);

	const scale = sorted.length
		? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || sorted[sorted.length - 1]
		: 1;

	const wrap = el.createDiv({ cls: "udash-heatmap" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: heatmap.title(widget) });

	const meta = head.createDiv({ cls: "udash-heatmap-meta" });

	if (widget.streak) {
		const run = currentStreak(days, widget);

		meta.createSpan({
			cls: "udash-heatmap-streak",
			text: `${run} in a row`,
		});
	}

	meta.createSpan({
		cls: "udash-heatmap-count",
		text: `${values.size} ${values.size === 1 ? "day" : "days"}`,
	});

	const months = wrap.createDiv({ cls: "udash-heatmap-months" });
	const boxes = wrap.createDiv({ cls: "udash-heatmap-boxes" });

	const total = Math.max(1, daysBetween(start, end));
	const lead = new Date(start + "T00:00:00").getDay();
	const weeks = Math.ceil((lead + total) / 7);
	months.style.gridTemplateColumns = `repeat(${weeks}, minmax(0, 1fr))`;
	boxes.style.gridTemplateColumns = `repeat(${weeks}, minmax(0, 1fr))`;

	for (let i = 0; i < lead; i++) boxes.createDiv({ cls: "udash-box udash-box-pad" });

	const todayISO = today();
	const monthAtColumn = new Map<number, { column: number; year: number }>();
	const startDate = new Date(start + "T00:00:00");

	for (let i = 0; i < total; i++) {
		const d = new Date(startDate);
		d.setDate(d.getDate() + i);
		const iso = toISO(d);
		const column = Math.floor((i + lead) / 7);

		// label the first column too, so a window starting mid-month is readable
		if (d.getDate() === 1 || i === 0) {
			if (!monthAtColumn.has(d.getMonth())) {
				monthAtColumn.set(d.getMonth(), { column, year: d.getFullYear() });
			}
		}

		const box = boxes.createDiv({ cls: "udash-box" });
		const v = values.get(iso);

		if (v !== undefined) {
			const ratio = scale > 0 ? Math.min(1, v / scale) : 1;
			const bucket = Math.max(1, Math.ceil(ratio * 5));
			box.style.backgroundColor = shade(color, 0.2 * bucket);
			box.setAttr("aria-label", `${iso}: ${widget.intensity ? v : "yes"}`);
		}

		if (iso === todayISO) box.addClass("udash-box-today");
	}

	// a window spanning more than one year needs the year to disambiguate
	const multiYear = start.slice(0, 4) !== end.slice(0, 4);

	for (const [month, { column, year }] of monthAtColumn) {
		const label = months.createSpan({
			cls: "udash-month",
			text: multiYear ? `${MONTHS_SHORT[month]} ${String(year).slice(2)}` : MONTHS_SHORT[month],
		});

		label.style.gridColumn = `${column + 1}`;
	}
}

export const heatmap: WidgetSpec<HeatmapWidget> = {
	type: WidgetKind.Heatmap,
	label: "Heatmap",
	hint: "A year of activity",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{ key: "intensity", kind: FieldKind.Property, label: "Shade by", hint: "Numeric property" },
		{ key: "color", kind: FieldKind.Colour, label: "Color", placeholder: "#3b82f6" },
		{
			key: "below",
			kind: FieldKind.Number,
			label: "Only days below",
			hint: "Count a day only when the property is under this number",
		},
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
	render: (el, widget, ctx) => renderHeatmap(el, ctx.days, widget),
};
