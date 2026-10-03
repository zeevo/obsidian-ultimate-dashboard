import { DAY_MS, MONTHS_SHORT, WEEKDAYS, hhmm, sameDay } from "../dates";
import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { CalendarSource } from "../store";
import { NO_CALENDARS, addEventButton, calendarError, offerCalendars, pickSources, showSignInExpired, writableTargets } from "./calendars";
import { CalendarHost } from "./host";
import { RenderContext, UpcomingWidget, WidgetSpec } from "./types";

function dayLabel(d: Date, today: Date): string {
	const tomorrow = new Date(today.getTime() + DAY_MS);

	if (sameDay(d, today)) return "Today";

	if (sameDay(d, tomorrow)) return "Tomorrow";

	return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * The agenda shell. Events arrive asynchronously, so this draws the heading and
 * a loading line, and `fillCalendar` replaces the body once the feeds resolve.
 */
export function renderUpcoming(el: HTMLElement, widget: UpcomingWidget): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-calendar" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: upcoming.title(widget) });
	// where the new event button goes, as on a month grid
	head.createDiv({ cls: "udash-calendar-actions" });
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

	for (const message of errors) calendarError(body, message);

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

/** Loads the next stretch of events in the background and fills the agenda. */
async function loadAgenda(shell: HTMLElement, widget: UpcomingWidget, host: CalendarHost, sources: CalendarSource[]): Promise<void> {
	addEventButton(shell, host, writableTargets(sources));

	const from = new Date();

	if (!widget.past) from.setHours(0, 0, 0, 0);
	const to = new Date(from.getTime() + (widget.ahead ?? 14) * DAY_MS);

	const { events, errors, expired } = await host.events(sources, from, to);

	if (!shell.isConnected) return;

	if (expired.length > 0) {
		showSignInExpired(shell, host, upcoming.title(widget), undefined, expired[0]);

		return;
	}

	const now = new Date();

	const visible = events
		.filter((e) => (widget.past ? true : e.end >= now))
		.slice(0, widget.limit ?? 25);

	fillCalendar(shell, visible, errors, sources.length > 1);
}

function renderUpcomingWidget(el: HTMLElement, widget: UpcomingWidget, ctx: RenderContext): void {
	const shell = renderUpcoming(el, widget);
	const picked = pickSources(widget, ctx.host);

	if ("missing" in picked && picked.missing !== NO_CALENDARS) {
		// naming a calendar that does not exist is the widget's own mistake
		ctx.fail(picked.missing);
	} else if ("missing" in picked) {
		fillCalendar(shell, [], [picked.missing], false);
		offerCalendars(shell.querySelector(".udash-calendar-body"), ctx.host);
	} else {
		void loadAgenda(shell, widget, picked.host, picked.sources);
	}
}

export const upcoming: WidgetSpec<UpcomingWidget> = {
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
	render: renderUpcomingWidget,
};
