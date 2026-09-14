import * as z from "zod/mini";

/** Saved dashboards. Persisted to the plugin's data.json, not to a note. */

export interface Dashboard {
	id: string;
	name: string;
	/** The layout, as YAML. Same shape a `dashboard` code block takes. */
	config: string;
}

/**
 * A subscribed calendar feed. Google Calendar publishes one of these per
 * calendar under Settings > Integrate calendar > "Secret address in iCal
 * format", which is why this needs no OAuth.
 */
export interface CalendarSource {
	id: string;
	name: string;
	type: "ics" | "google";
	color?: string;
	/** ics only. */
	url?: string;
	/** google only: which connected account this calendar belongs to. */
	accountId?: string;
	/** google only: which calendar in that account. */
	calendarId?: string;
	/** google only: whether new events may be written here. */
	writable?: boolean;
}

/** One connected Google account. Tokens live here, in data.json. */
export interface GoogleAccountRecord {
	id: string;
	email?: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

/**
 * The OAuth client is one Google Cloud project and is shared, but any number of
 * accounts can be connected through it. Accounts are global: every dashboard
 * draws from the same pool of calendars, and a widget picks by name.
 */
export interface GoogleConfig {
	clientId: string;
	clientSecret: string;
	/** Loopback port for the OAuth redirect. Must match the registered URI. */
	port: number;
	accounts: GoogleAccountRecord[];
}

export interface DashboardSettings {
	dashboards: Dashboard[];
	/** Which dashboard the view shows. Falls back to the first if unknown. */
	activeId: string;
	/**
	 * Opened automatically when Obsidian starts. Absent means startup is left
	 * alone, which is the default: a plugin that seizes a tab uninvited is rude.
	 */
	startupId?: string;
	/** Calendar sources, shared by every dashboard. */
	calendars: CalendarSource[];
	google: GoogleConfig;
}

export const DEFAULT_CONFIG = `folder: Daily
layout:
  type: column
  gap: 22
  children:
    - type: row
      children:
        - { type: stat, label: Weight, property: weight, unit: lb }
        - { type: stat, label: 7 day average, property: weight, agg: mean, back: 7, unit: lb }
        - { type: stat, label: Lifts this week, property: lift, agg: count, back: 7, target: 3 }
    - type: row
      children:
        - { type: line, title: Weight, property: weight, rolling: 7, unit: lb, months: 6, flex: 2 }
        - { type: heatmap, title: Lifting, property: lift, color: "#ef4444", months: 6, flex: 1 }
`;

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function makeDashboard(name: string, config = DEFAULT_CONFIG): Dashboard {
	return { id: newId(), name, config };
}

export function makeCalendar(name: string, url = ""): CalendarSource {
	return { id: newId(), name, type: "ics", url };
}

export function makeGoogleCalendar(
	name: string,
	accountId: string,
	calendarId: string,
	writable: boolean,
): CalendarSource {
	return { id: newId(), name, type: "google", accountId, calendarId, writable };
}

export function defaultGoogle(): GoogleConfig {
	return { clientId: "", clientSecret: "", port: 42813, accounts: [] };
}

export function findAccount(
	google: GoogleConfig,
	accountId?: string,
): GoogleAccountRecord | undefined {
	if (accountId) return google.accounts.find((a) => a.id === accountId);

	return google.accounts[0];
}

export function defaultSettings(): DashboardSettings {
	const first = makeDashboard("Health");

	return { dashboards: [first], activeId: first.id, calendars: [], google: defaultGoogle() };
}

/**
 * The stored shapes.
 *
 * `catch` rather than `optional` where a bad value should become a good one:
 * data.json is written by this plugin, but it is also a file a person can edit,
 * and losing every dashboard to one mistyped field would be unforgivable.
 */
const StoredDashboard = z.object({
	id: z.optional(z.string()),
	name: z.optional(z.string()),
	config: z.string(),
});

const StoredAccount = z.object({
	id: z.optional(z.string()),
	email: z.optional(z.string()),
	accessToken: z._default(z.catch(z.string(), ""), ""),
	refreshToken: z.string(),
	expiresAt: z._default(z.catch(z.number(), 0), 0),
});

const StoredGoogle = z.object({
	clientId: z._default(z.catch(z.string(), ""), ""),
	clientSecret: z._default(z.catch(z.string(), ""), ""),
	port: z.optional(z.number()),
	accounts: z.optional(z.array(z.unknown())),
	/** v0.2 held a single account here. */
	account: z.optional(z.unknown()),
});

const StoredCalendar = z.object({
	id: z.optional(z.string()),
	name: z.optional(z.string()),
	type: z.optional(z.string()),
	url: z.optional(z.string()),
	accountId: z.optional(z.string()),
	calendarId: z.optional(z.string()),
	writable: z.optional(z.boolean()),
	color: z.optional(z.string()),
});

const StoredSettings = z.object({
	dashboards: z.optional(z.array(z.unknown())),
	activeId: z.optional(z.string()),
	startupId: z.optional(z.string()),
	calendars: z.optional(z.array(z.unknown())),
	google: z.optional(z.unknown()),
	/** v0.1 held one config here and no dashboards list. */
	config: z.optional(z.string()),
});

/** Rows that do not match are dropped rather than taking the file down. */
function rows<S extends z.ZodMiniType>(schema: S, raw: unknown[] | undefined): z.infer<S>[] {
	const out: z.infer<S>[] = [];

	for (const item of raw ?? []) {
		const parsed = schema.safeParse(item);

		if (parsed.success) out.push(parsed.data);
	}

	return out;
}

const text = (v: string | undefined, fallback: string) => (v?.trim() ? v.trim() : fallback);

/**
 * Accepts whatever is in data.json, including the older single-config shape,
 * and returns something the rest of the plugin can rely on.
 */
export function migrate(raw: unknown): DashboardSettings {
	const fallback = defaultSettings();
	const read = StoredSettings.safeParse(raw);

	if (!read.success) return fallback;
	const d = read.data;

	const google = readGoogle(d.google);
	const calendars = readCalendars(d.calendars, google);

	// v0.1: { config: "..." }
	if (d.config !== undefined && d.dashboards === undefined) {
		const only = makeDashboard("Health", d.config);

		return { dashboards: [only], activeId: only.id, calendars, google };
	}

	const dashboards: Dashboard[] = rows(StoredDashboard, d.dashboards).map((x) => ({
		id: text(x.id, newId()),
		name: text(x.name, "Untitled"),
		config: x.config,
	}));

	if (dashboards.length === 0) return { ...fallback, calendars, google };

	const known = (id: string | undefined) => (id && dashboards.some((x) => x.id === id) ? id : undefined);

	// a startup choice pointing at a deleted dashboard is dropped, not repaired:
	// silently opening a different one is worse than opening none
	return {
		dashboards,
		activeId: known(d.activeId) ?? dashboards[0].id,
		startupId: known(d.startupId),
		calendars,
		google,
	};
}

function readGoogle(raw: unknown): GoogleConfig {
	const base = defaultGoogle();
	const read = StoredGoogle.safeParse(raw);

	if (!read.success) return base;
	const g = read.data;
	// v0.2 held a single `account`; anything found there becomes the first entry
	const listed = g.accounts ?? (g.account === undefined ? [] : [g.account]);

	const accounts: GoogleAccountRecord[] = rows(StoredAccount, listed)
		.filter((a) => a.refreshToken !== "")
		.map((a) => ({
			id: text(a.id, newId()),
			email: a.email,
			accessToken: a.accessToken,
			refreshToken: a.refreshToken,
			expiresAt: a.expiresAt,
		}));

	return {
		clientId: g.clientId,
		clientSecret: g.clientSecret,
		port: g.port !== undefined && g.port > 0 ? g.port : base.port,
		accounts,
	};
}

function readCalendars(raw: unknown[] | undefined, google: GoogleConfig): CalendarSource[] {
	const out: CalendarSource[] = [];

	for (const x of rows(StoredCalendar, raw)) {
		const type = x.type === "google" ? "google" : "ics";
		const url = x.url?.trim() ?? "";
		const calendarId = x.calendarId?.trim() ?? "";

		// a source with nothing to point at cannot be loaded
		if (type === "ics" && !url) continue;

		if (type === "google" && !calendarId) continue;
		out.push({
			id: text(x.id, newId()),
			name: text(x.name, "Calendar"),
			type,
			url: url || undefined,
			accountId: type === "google" ? (x.accountId || google.accounts[0]?.id) : undefined,
			calendarId: calendarId || undefined,
			writable: x.writable === true,
			color: x.color,
		});
	}

	return out;
}

export function activeDashboard(settings: DashboardSettings): Dashboard {
	return settings.dashboards.find((d) => d.id === settings.activeId) ?? settings.dashboards[0];
}

/** A name not already taken, so the dropdown never shows two identical entries. */
export function uniqueName(settings: DashboardSettings, wanted: string): string {
	const base = wanted.trim() || "Untitled";
	const taken = new Set(settings.dashboards.map((d) => d.name));

	if (!taken.has(base)) return base;

	for (let n = 2; ; n++) {
		const candidate = `${base} ${n}`;

		if (!taken.has(candidate)) return candidate;
	}
}
