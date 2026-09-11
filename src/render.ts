import { Agg, CalendarPanel, HeatmapPanel, LinePanel, StatPanel, UpcomingPanel } from "./panels";
import { assertNever } from "./kinds";
import { DayRecord, daysBetween, num, shiftDate, shiftMonths, toISO, today, truthy } from "./data";

const DEFAULT_COLOR = "#3b82f6";

/** `#rrggbb` to an rgba() string at the given alpha. Falls back to the default. */
function shade(hex: string, alpha: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	const h = m ? m[1] : DEFAULT_COLOR.slice(1);
	const n = parseInt(h, 16);

	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ------------------------------------------------------------------- stat */

function aggregate(days: DayRecord[], panel: StatPanel): number | null {
	const from = panel.back ? shiftDate(today(), -(panel.back - 1)) : null;
	const scope = from ? days.filter((d) => d.date >= from) : days;
	const agg = panel.agg ?? Agg.Latest;

	if (agg === Agg.Count) return scope.filter((d) => truthy(d, panel.property)).length;

	const vals: number[] = [];

	for (const day of scope) {
		const v = num(day, panel.property);

		if (v !== null) vals.push(v);
	}

	if (vals.length === 0) return null;

	switch (agg) {
		case Agg.Latest:
			return vals[vals.length - 1];
		case Agg.Sum:
			return vals.reduce((a, b) => a + b, 0);
		case Agg.Mean:
			return vals.reduce((a, b) => a + b, 0) / vals.length;
		case Agg.Delta:
			return vals[vals.length - 1] - vals[0];
		default:
			return assertNever(agg, "aggregate");
	}
}

/** One number. Arrange several with rows and columns. */
export function renderStat(el: HTMLElement, days: DayRecord[], panel: StatPanel): void {
	const agg = panel.agg ?? Agg.Latest;
	const value = aggregate(days, panel);
	const precision = panel.precision ?? (agg === Agg.Count ? 0 : 1);
	const card = el.createDiv({ cls: "udash-tile" });

	card.createDiv({ cls: "udash-tile-label", text: panel.label ?? panel.property });

	const valueEl = card.createDiv({ cls: "udash-tile-value" });

	if (value === null) {
		valueEl.setText("\u2014");
	} else {
		const shown =
			agg === Agg.Delta && value > 0 ? "+" + value.toFixed(precision) : value.toFixed(precision);

		valueEl.setText(shown);

		if (panel.target !== undefined) {
			valueEl.createSpan({ cls: "udash-tile-target", text: ` / ${panel.target}` });
		}

		if (panel.unit) valueEl.createSpan({ cls: "udash-tile-unit", text: ` ${panel.unit}` });
	}

	card.createDiv({ cls: "udash-tile-sub", text: panel.back ? `last ${panel.back} days` : agg });
}

/* ---------------------------------------------------------------- heatmap */

/**
 * The date window a panel covers. `fallback` decides what an unset range means:
 * a heatmap needs a concrete year to draw, a line chart just plots everything.
 */
export interface DateWindow {
	start: string;
	end: string;
}

export function resolveWindow(
	range: { year?: number; months?: number; back?: number; from?: string; to?: string },
	days: DayRecord[],
	fallback: "year" | "all",
): DateWindow {
	const now = today();

	if (range.from !== undefined || range.to !== undefined) {
		return {
			start: range.from ?? (days.length ? days[0].date : now),
			end: range.to ?? now,
		};
	}

	if (range.months !== undefined) {
		return { start: shiftDate(shiftMonths(now, -range.months), 1), end: now };
	}

	if (range.back !== undefined) {
		return { start: shiftDate(now, -(range.back - 1)), end: now };
	}

	if (range.year !== undefined) {
		return { start: `${range.year}-01-01`, end: `${range.year}-12-31` };
	}

	if (fallback === "year") {
		const y = new Date().getFullYear();

		return { start: `${y}-01-01`, end: `${y}-12-31` };
	}

	return {
		start: days.length ? days[0].date : now,
		end: days.length ? days[days.length - 1].date : now,
	};
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function renderHeatmap(el: HTMLElement, days: DayRecord[], panel: HeatmapPanel): void {
	const color = panel.color ?? DEFAULT_COLOR;
	const { start, end } = resolveWindow(panel, days, "year");

	const values = new Map<string, number>();

	for (const day of days) {
		if (day.date < start || day.date > end) continue;

		if (!truthy(day, panel.property) && !(panel.intensity && num(day, panel.intensity) !== null)) {
			continue;
		}

		values.set(day.date, panel.intensity ? (num(day, panel.intensity) ?? 1) : 1);
	}

	// Scale to the 90th percentile, not the max: one unusually long ride would
	// otherwise push every ordinary day into the palest bucket.
	const sorted = [...values.values()].sort((a, b) => a - b);

	const scale = sorted.length
		? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || sorted[sorted.length - 1]
		: 1;

	const wrap = el.createDiv({ cls: "udash-heatmap" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: panel.title ?? panel.property });
	head.createSpan({
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
			box.setAttr("aria-label", `${iso}: ${panel.intensity ? v : "yes"}`);
		}

		if (iso === todayISO) box.addClass("udash-box-today");
	}

	// a window spanning more than one year needs the year to disambiguate
	const multiYear = start.slice(0, 4) !== end.slice(0, 4);

	for (const [month, { column, year }] of monthAtColumn) {
		const label = months.createSpan({
			cls: "udash-month",
			text: multiYear ? `${MONTH_NAMES[month]} ${String(year).slice(2)}` : MONTH_NAMES[month],
		});

		label.style.gridColumn = `${column + 1}`;
	}
}

/* ------------------------------------------------------------------- line */

export function renderLine(el: HTMLElement, days: DayRecord[], panel: LinePanel): void {
	const all: { date: string; v: number }[] = [];

	for (const day of days) {
		const v = num(day, panel.property);

		if (v !== null) all.push({ date: day.date, v });
	}

	const { start, end } = resolveWindow(panel, days, "all");
	const points = all.filter((p) => p.date >= start && p.date <= end);

	const wrap = el.createDiv({ cls: "udash-line" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: panel.title ?? panel.property });
	head.createSpan({
		cls: "udash-heatmap-count",
		text: `${points.length} ${points.length === 1 ? "reading" : "readings"}`,
	});

	if (points.length < 2) {
		wrap.createDiv({ cls: "udash-empty", text: "Not enough readings to plot yet." });

		return;
	}

	const ms = (iso: string) => new Date(iso + "T00:00:00").getTime();
	const DAY = 86400000;

	// Rolling average over a calendar window, so gaps in logging do not distort
	// it. Averaged over `all`, not `points`, so readings just before the window
	// still inform the leftmost values instead of the line starting cold.
	const smoothed = panel.rolling
		? points.map((p) => {
				const from = ms(p.date) - (panel.rolling! - 1) * DAY;
				const win = all.filter((o) => ms(o.date) >= from && ms(o.date) <= ms(p.date));

				return { date: p.date, v: win.reduce((s, o) => s + o.v, 0) / win.length };
			})
		: points;

	const W = 720, H = 240, ml = 46, mr = 14, mt = 12, mb = 26;
	const x0 = ms(points[0].date);
	const x1 = ms(points[points.length - 1].date);
	const vals = points.map((p) => p.v);
	let lo = Math.min(...vals), hi = Math.max(...vals);
	const pad = (hi - lo) * 0.12 || 1;
	lo -= pad; hi += pad;

	const X = (iso: string) => ml + ((ms(iso) - x0) / (x1 - x0 || 1)) * (W - ml - mr);
	const Y = (v: number) => mt + ((hi - v) / (hi - lo)) * (H - mt - mb);

	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
	svg.setAttribute("width", "100%");
	svg.addClass("udash-svg");

	const add = (tag: string, attrs: Record<string, string>, text?: string) => {
		const node = document.createElementNS("http://www.w3.org/2000/svg", tag);

		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);

		if (text !== undefined) node.textContent = text;
		svg.appendChild(node);

		return node;
	};

	for (let i = 0; i < 4; i++) {
		const v = lo + ((hi - lo) * i) / 3;
		const y = Y(v).toFixed(1);
		add("line", { x1: String(ml), y1: y, x2: String(W - mr), y2: y, class: "udash-grid" });
		add("text", { x: String(ml - 8), y, "text-anchor": "end", "dominant-baseline": "middle", class: "udash-axis" }, v.toFixed(1) + (panel.unit ? ` ${panel.unit}` : ""));
	}

	let seen = "";

	for (const p of points) {
		const key = p.date.slice(0, 7);

		if (key === seen) continue;
		seen = key;
		add("text", { x: X(p.date).toFixed(1), y: String(H - 7), "text-anchor": "middle", class: "udash-axis" }, key);
	}

	for (const p of points) {
		add("circle", { cx: X(p.date).toFixed(1), cy: Y(p.v).toFixed(1), r: "2", class: "udash-dot" });
	}

	const d = smoothed
		.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)} ${Y(p.v).toFixed(1)}`)
		.join(" ");

	add("path", { d, fill: "none", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round", stroke: panel.color ?? "var(--interactive-accent)" });

	wrap.appendChild(svg);
}

/* --------------------------------------------------------------- calendar */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(d: Date, today: Date): string {
	const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
	const tomorrow = new Date(today.getTime() + 86400000);

	if (same(d, today)) return "Today";

	if (same(d, tomorrow)) return "Tomorrow";

	return `${DOW[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

const hhmm = (d: Date) =>
	`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * The agenda shell. Events arrive asynchronously, so this draws the heading and
 * a loading line, and `fillCalendar` replaces the body once the feeds resolve.
 */
export function renderUpcoming(el: HTMLElement, panel: UpcomingPanel): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-calendar" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: panel.title ?? "Upcoming" });
	const body = wrap.createDiv({ cls: "udash-calendar-body" });
	body.createDiv({ cls: "udash-empty", text: "Loading calendars\u2026" });

	return wrap;
}

export interface AgendaEvent {
	summary: string;
	location?: string;
	start: Date;
	end: Date;
	allDay: boolean;
	calendar: string;
	color?: string;
}

/** Fills a shell created by `renderCalendar`. */
export function fillCalendar(
	wrap: HTMLElement,
	events: AgendaEvent[],
	errors: string[],
	showCalendarName: boolean,
): void {
	// SAFETY: a div created by renderCalendar on this same element; the early
	// return below covers its absence if the shell was replaced.
	const body = wrap.querySelector(".udash-calendar-body") as HTMLElement | null;

	if (!body) return;
	body.empty();

	for (const message of errors) {
		const err = body.createDiv({ cls: "udash-error" });
		err.createSpan({ cls: "udash-error-tag", text: "calendar" });
		err.createSpan({ text: message });
	}

	if (events.length === 0) {
		if (errors.length === 0) body.createDiv({ cls: "udash-empty", text: "Nothing scheduled." });

		return;
	}

	const today = new Date();
	let lastDay = "";

	for (const e of events) {
		const key = e.start.toDateString();

		if (key !== lastDay) {
			lastDay = key;
			body.createDiv({ cls: "udash-agenda-day", text: dayLabel(e.start, today) });
		}

		const row = body.createDiv({ cls: "udash-agenda-row" });

		if (e.color) {
			const dot = row.createDiv({ cls: "udash-agenda-dot" });
			dot.style.backgroundColor = e.color;
		}

		row.createSpan({
			cls: "udash-agenda-time",
			text: e.allDay ? "all day" : hhmm(e.start),
		});
		const main = row.createDiv({ cls: "udash-agenda-main" });
		main.createSpan({ cls: "udash-agenda-summary", text: e.summary });
		const meta = [showCalendarName ? e.calendar : "", e.location ?? ""].filter(Boolean).join(" \u00b7 ");

		if (meta) main.createSpan({ cls: "udash-agenda-meta", text: meta });
	}
}

/* ------------------------------------------------------------ month grid */

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface MonthWindow {
	/** The first of the displayed month. */
	first: Date;
	/** Start of the grid, which may fall in the previous month. */
	from: Date;
	/** End of the grid, six weeks on. */
	to: Date;
}

/** The month a panel opens on, and the window covering its whole grid. */
export function monthWindow(panel: CalendarPanel): MonthWindow {
	const now = new Date();

	const first = panel.month
		? new Date(Number(panel.month.slice(0, 4)), Number(panel.month.slice(5, 7)) - 1, 1)
		: new Date(now.getFullYear(), now.getMonth(), 1);

	const weekStart = panel.weekStart ?? 0;
	const lead = (first.getDay() - weekStart + 7) % 7;
	const from = new Date(first);

	from.setDate(from.getDate() - lead);

	const to = new Date(from);

	// six rows always, so the grid does not jump height between months
	to.setDate(to.getDate() + 42);

	return { first, from, to };
}

/** The month shell: heading, weekday row, and 42 empty day cells. */
export function renderMonth(el: HTMLElement, panel: CalendarPanel, first: Date): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-month" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });

	head.createSpan({
		cls: "udash-month-title",
		text: panel.title ?? `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`,
	});
	head.createDiv({ cls: "udash-calendar-actions" });

	const weekStart = panel.weekStart ?? 0;
	const dows = wrap.createDiv({ cls: "udash-month-dows" });

	for (let i = 0; i < 7; i++) {
		dows.createDiv({ cls: "udash-month-dow", text: DOW_SHORT[(i + weekStart) % 7] });
	}

	wrap.createDiv({ cls: "udash-month-grid" });

	return wrap;
}

export interface MonthEvent {
	summary: string;
	start: Date;
	end: Date;
	allDay: boolean;
	color?: string;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Fills a shell from `renderMonth`. */
export function fillMonth(
	wrap: HTMLElement,
	panel: CalendarPanel,
	first: Date,
	events: MonthEvent[],
	errors: string[],
): void {
	// SAFETY: a div created by renderMonth on this same element; the early return
	// below covers its absence if the shell was replaced.
	const grid = wrap.querySelector(".udash-month-grid") as HTMLElement | null;

	if (!grid) return;
	grid.empty();

	for (const message of errors) {
		const err = wrap.createDiv({ cls: "udash-error" });

		err.createSpan({ cls: "udash-error-tag", text: "calendar" });
		err.createSpan({ text: message });
	}

	const { from } = monthWindow(panel);
	const today = new Date();
	const maxPerDay = panel.maxPerDay ?? 3;

	for (let i = 0; i < 42; i++) {
		const day = new Date(from);

		day.setDate(day.getDate() + i);

		const cell = grid.createDiv({ cls: "udash-month-cell" });

		if (day.getMonth() !== first.getMonth()) cell.addClass("is-outside");

		if (sameDay(day, today)) cell.addClass("is-today");
		cell.createDiv({ cls: "udash-month-daynum", text: String(day.getDate()) });

		// an event belongs to every day it spans, not just the one it starts on
		const onDay = events.filter((e) => {
			const endsBefore = e.end <= new Date(day.getFullYear(), day.getMonth(), day.getDate());

			return e.start < new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) && !endsBefore;
		});

		for (const e of onDay.slice(0, maxPerDay)) {
			const chip = cell.createDiv({ cls: "udash-month-chip" });

			if (e.color) chip.style.borderLeftColor = e.color;

			if (!e.allDay) {
				chip.createSpan({
					cls: "udash-month-chip-time",
					text: `${e.start.getHours()}:${String(e.start.getMinutes()).padStart(2, "0")}`,
				});
			}

			chip.createSpan({ cls: "udash-month-chip-text", text: e.summary });
		}

		if (onDay.length > maxPerDay) {
			cell.createDiv({
				cls: "udash-month-more",
				text: `+${onDay.length - maxPerDay} more`,
			});
		}
	}
}
