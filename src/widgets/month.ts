import { WEEKDAYS, hhmm, monthName, sameDay } from "../dates";
import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { CalendarSource } from "../store";
import { NO_CALENDARS, addEventButton, calendarError, offerCalendars, pickSources, showSignInExpired, writableTargets } from "./calendars";
import { CalendarHost } from "./host";
import { CalendarWidget, RenderContext, WidgetSpec } from "./types";

export interface MonthWindow {
	/** The first of the displayed month. */
	first: Date;
	/** Start of the grid, which may fall in the previous month. */
	from: Date;
	/** End of the grid, six weeks on. */
	to: Date;
}

/** The month a widget opens on, and the window covering its whole grid. */
export function monthWindow(widget: CalendarWidget): MonthWindow {
	const now = new Date();

	const first = widget.month
		? new Date(Number(widget.month.slice(0, 4)), Number(widget.month.slice(5, 7)) - 1, 1)
		: new Date(now.getFullYear(), now.getMonth(), 1);

	const weekStart = widget.weekStart ?? 0;
	const lead = (first.getDay() - weekStart + 7) % 7;
	const from = new Date(first);

	from.setDate(from.getDate() - lead);

	const to = new Date(from);

	// six rows always, so the grid does not jump height between months
	to.setDate(to.getDate() + 42);

	return { first, from, to };
}

/** The widget as if configured `by` months later, for paging without saving. */
export function shiftMonth(widget: CalendarWidget, by: number): CalendarWidget {
	if (by === 0) return widget;

	const { first } = monthWindow(widget);
	const shifted = new Date(first.getFullYear(), first.getMonth() + by, 1);
	const month = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;

	return { ...widget, month };
}

/**
 * Previous and next buttons in a month shell's header, with a month label
 * between them that only fills when a custom title hides the month.
 */
export function addMonthArrows(wrap: HTMLElement, onStep: (by: number) => void): void {
	// SAFETY: a div created by renderMonth on this same element; the early
	// return below covers its absence if the shell was replaced.
	const actions = wrap.querySelector(".udash-calendar-actions") as HTMLElement | null;

	if (!actions) return;

	const prev = actions.createEl("button", { cls: "udash-bar-button", text: "\u2039" });

	actions.createSpan({ cls: "udash-month-label" });

	const next = actions.createEl("button", { cls: "udash-bar-button", text: "\u203a" });

	prev.setAttribute("aria-label", "Previous month");
	next.setAttribute("aria-label", "Next month");
	prev.addEventListener("click", () => onStep(-1));
	next.addEventListener("click", () => onStep(1));
}

/** Points a month shell's header at the month now on show. */
export function labelMonth(wrap: HTMLElement, shown: CalendarWidget): void {
	wrap.querySelector(".udash-month-title")?.setText(month.title(shown));
	wrap.querySelector(".udash-month-label")?.setText(shown.title ? monthName(shown.month) : "");
}

/** The month shell: heading, weekday row, and 42 empty day cells. */
export function renderMonth(el: HTMLElement, widget: CalendarWidget): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-month" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });

	head.createSpan({
		cls: "udash-month-title",
		text: month.title(widget),
	});
	head.createDiv({ cls: "udash-calendar-actions" });

	const weekStart = widget.weekStart ?? 0;
	const dows = wrap.createDiv({ cls: "udash-month-dows" });

	for (let i = 0; i < 7; i++) {
		dows.createDiv({ cls: "udash-month-dow", text: WEEKDAYS[(i + weekStart) % 7] });
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

/** Fills a shell from `renderMonth`. */
export function fillMonth<E extends MonthEvent>(
	wrap: HTMLElement,
	widget: CalendarWidget,
	first: Date,
	events: E[],
	errors: string[],
	/** Supplied when a writable calendar is in scope, so a day can be clicked. */
	onPickDay?: (day: Date) => void,
	/** Supplied to open an event's details when its chip is clicked. */
	onPickEvent?: (event: E) => void,
): void {
	// SAFETY: a div created by renderMonth on this same element; the early return
	// below covers its absence if the shell was replaced.
	const grid = wrap.querySelector(".udash-month-grid") as HTMLElement | null;

	if (!grid) return;
	grid.empty();

	// the shell is refilled when paging months, so replace errors, never pile them up
	const box = wrap.querySelector(".udash-month-errors") ?? wrap.createDiv({ cls: "udash-month-errors" });

	box.empty();

	for (const message of errors) calendarError(box, message);

	const { from } = monthWindow(widget);
	const today = new Date();
	const maxPerDay = widget.maxPerDay ?? 3;

	for (let i = 0; i < 42; i++) {
		const day = new Date(from);

		day.setDate(day.getDate() + i);

		const cell = grid.createDiv({ cls: "udash-month-cell" });

		if (onPickDay) {
			const picked = new Date(day);

			cell.addClass("is-clickable");
			cell.addEventListener("click", () => onPickDay(picked));
		}

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
					text: hhmm(e.start),
				});
			}

			chip.createSpan({ cls: "udash-month-chip-text", text: e.summary });

			if (onPickEvent) {
				chip.addClass("is-clickable");
				chip.addEventListener("click", (ev) => {
					// the day cell underneath would otherwise open the new event form
					ev.stopPropagation();
					onPickEvent(e);
				});
			}
		}

		if (onDay.length > maxPerDay) {
			cell.createDiv({
				cls: "udash-month-more",
				text: `+${onDay.length - maxPerDay} more`,
			});
		}
	}
}

/**
 * Draws the month and lets it be paged. Each page loads in the background; a
 * slower answer for a month already paged past is dropped.
 */
function pageMonths(
	shell: HTMLElement,
	widget: CalendarWidget,
	host: CalendarHost,
	sources: CalendarSource[],
	key: string,
): void {
	const targets = writableTargets(sources);
	let latest = 0;

	const show = () => {
		const shown = shiftMonth(widget, host.monthOffsets.get(key) ?? 0);
		const { first, from, to } = monthWindow(shown);
		const request = ++latest;

		labelMonth(shell, shown);

		void host.events(sources, from, to).then(({ events, errors, expired }) => {
			// the view may have re-rendered, or the month moved on, while the fetch
			// was in flight
			if (!shell.isConnected || request !== latest) return;

			if (expired.length > 0) {
				// a custom title replaces the month name, so bring the month back beside it
				const meta = shown.title ? monthName(shown.month) : undefined;

				showSignInExpired(shell, host, month.title(shown), meta, expired[0]);

				return;
			}

			fillMonth(
				shell,
				shown,
				first,
				events,
				errors,
				targets.length > 0 ? (day) => host.createEvent(targets, day) : undefined,
				(event) => host.showEvent(event),
			);
		});
	};

	addMonthArrows(shell, (by) => {
		host.monthOffsets.set(key, (host.monthOffsets.get(key) ?? 0) + by);
		show();
	});
	addEventButton(shell, host, targets);
	show();
}

function renderMonthWidget(el: HTMLElement, widget: CalendarWidget, ctx: RenderContext): void {
	// taken before anything can bail out, so every month grid keeps its position
	const key = ctx.host?.nextMonthKey() ?? "";
	const shell = renderMonth(el, widget);
	const picked = pickSources(widget, ctx.host);

	if ("missing" in picked) {
		fillMonth(shell, widget, monthWindow(widget).first, [], [picked.missing]);

		if (picked.missing === NO_CALENDARS) offerCalendars(shell.querySelector(".udash-month-errors"), ctx.host);
	} else {
		pageMonths(shell, widget, picked.host, picked.sources, key);
	}
}

export const month: WidgetSpec<CalendarWidget> = {
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
	render: renderMonthWidget,
};
