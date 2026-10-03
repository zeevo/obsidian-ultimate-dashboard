import { Component } from "obsidian";
import { DatedEvent } from "../calendar";
import { CalendarSource } from "../store";
import { Weather, WeatherQuery } from "../weather";

/**
 * What widgets may ask of the live plugin, split by need so each widget
 * depends on its own slice rather than on the whole view. The view implements
 * all of them; the test harness implements none, and widgets that load content
 * then keep their placeholder.
 */

export interface ClockHost {
	/** A lifecycle owner released on the next redraw, for intervals and listeners. */
	own(): Component;
}

export interface NoteHost extends ClockHost {
	/** The note a link path resolves to, read in full, or null when there is none. */
	readNote(path: string): Promise<{ path: string; text: string } | null>;
	/** Renders markdown the way a normal note would, owned by `owner`. */
	renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, owner: Component): Promise<void>;
	/**
	 * How far each embedded note is scrolled, by path. The whole view is rebuilt
	 * whenever any note in the vault changes, so without this a tile you had
	 * scrolled would jump back to the top as you typed elsewhere.
	 */
	scrolled: Map<string, number>;
}

export interface WeatherHost {
	/** A forecast. Cached by the service, since the view redraws on every metadata change. */
	weather(query: WeatherQuery): Promise<Weather>;
}

/** A Google calendar that can take a new event. */
export interface EventTarget {
	id: string;
	accountId: string;
	name: string;
}

export interface CalendarHost {
	/** Every configured feed. */
	sources: CalendarSource[];
	events(
		sources: CalendarSource[],
		from: Date,
		to: Date,
	): Promise<{ events: DatedEvent[]; errors: string[]; expired: string[] }>;
	/** Opens the new event form, optionally on a chosen day. */
	createEvent(targets: EventTarget[], on?: Date): void;
	/** Opens an event's details. */
	showEvent(event: DatedEvent): void;
	/** The email of a connected Google account, to name it on a reconnect button. */
	accountEmail(accountId: string): string | undefined;
	/** Signs a Google account in again, keeping its calendars attached. */
	reconnectGoogle(accountId: string): void;
	/** Opens the calendar pool, to add or change feeds. */
	manageCalendars(): void;
	/**
	 * How many months each month grid has been paged from its configured month.
	 * Per tab and never saved, so a redraw keeps the month you browsed to but
	 * reopening starts over.
	 */
	monthOffsets: Map<string, number>;
	/** A key for the next month grid drawn. Widget ids are minted on every parse, so position is what stays stable. */
	nextMonthKey(): string;
}

export interface ImageHost {
	/** A URL the view can load for a vault file, or null when no file matches the path. */
	resourcePath(path: string): string | null;
}

export type WidgetHost = NoteHost & WeatherHost & CalendarHost & ImageHost;
