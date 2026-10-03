import { setTooltip } from "obsidian";
import { CalendarSource } from "../store";
import { CalendarHost, EventTarget } from "./host";
import { CalendarWidget, UpcomingWidget } from "./types";

/** Shown by a calendar widget when there are no feeds to draw from. */
export const NO_CALENDARS = "No calendars configured. Add one in settings.";

/** One failed feed, listed above whatever did load. */
export function calendarError(parent: Element, message: string): void {
	const err = parent.createDiv({ cls: "udash-error" });

	err.createSpan({ cls: "udash-error-tag", text: "calendar" });
	err.createSpan({ text: message });
}

/**
 * The feeds a widget asked for, or why there are none: no feeds at all, or
 * none matching the names it lists.
 */
export function pickSources(
	widget: CalendarWidget | UpcomingWidget,
	host: CalendarHost | undefined,
): { host: CalendarHost; sources: CalendarSource[] } | { missing: string } {
	const all = host?.sources ?? [];

	if (!host || all.length === 0) return { missing: NO_CALENDARS };

	const sources = widget.calendars ? all.filter((s) => widget.calendars!.includes(s.name)) : all;

	if (sources.length === 0) return { missing: `No calendar named ${(widget.calendars ?? []).join(", ")}` };

	return { host, sources };
}

/** Only Google calendars marked writable can take a new event. */
export function writableTargets(sources: CalendarSource[]): EventTarget[] {
	const targets: EventTarget[] = [];

	for (const source of sources) {
		// narrowing in the loop avoids asserting the optional fields are present
		if (source.type !== "google" || !source.writable) continue;

		if (!source.calendarId || !source.accountId) continue;
		targets.push({ id: source.calendarId, accountId: source.accountId, name: source.name });
	}

	return targets;
}

/** A "+" in the shell's header, when any of its calendars can take a new event. */
export function addEventButton(shell: HTMLElement, host: CalendarHost, targets: EventTarget[]): void {
	if (targets.length === 0) return;
	const actions = shell.querySelector(".udash-calendar-actions");

	if (!actions) return;
	const button = actions.createEl("button", { cls: "udash-bar-button", text: "+" });

	setTooltip(button, "New event");
	button.addEventListener("click", () => host.createEvent(targets));
}

/**
 * Replaces a calendar widget with one button, for when a Google account's sign
 * in has expired and no events can load until it is renewed. The title stays in
 * the corner so you can tell widgets apart, and the email names the account to
 * pick on Google's screen.
 */
export function fillSignInExpired(
	wrap: HTMLElement,
	title: string,
	/** Shown opposite the title, such as a month the title would otherwise hide. */
	meta: string | undefined,
	email: string | undefined,
	onReconnect: () => void,
): void {
	wrap.empty();
	wrap.addClass("udash-signin-expired");

	const head = wrap.createDiv({ cls: "udash-heatmap-head udash-signin-expired-title" });

	head.createSpan({ text: title });

	if (meta) head.createSpan({ cls: "udash-signin-expired-meta", text: meta });

	const button = wrap.createEl("button", { cls: "mod-cta", text: "Google Sign-in expired" });

	button.addEventListener("click", onReconnect);

	if (email) wrap.createDiv({ cls: "udash-signin-expired-email", text: email });
}

/** The reconnect button in place of a widget whose Google sign in has expired. */
export function showSignInExpired(
	shell: HTMLElement,
	host: CalendarHost,
	title: string,
	meta: string | undefined,
	accountId: string,
): void {
	fillSignInExpired(shell, title, meta, host.accountEmail(accountId), () => host.reconnectGoogle(accountId));
}
