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
 * draws from the same pool of calendars, and a panel picks by name.
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
	/** Calendar sources, shared by every dashboard. */
	calendars: CalendarSource[];
	google: GoogleConfig;
}

export const DEFAULT_CONFIG = `folder: Daily
layout:
  type: grid
  columns: 2
  gap: 22
  children:
    - type: stats
      span: 1
      tiles:
        - { label: Weight, property: weight, agg: latest, unit: lb }
        - { label: 7 day average, property: weight, agg: mean, days: 7, unit: lb }
        - { label: Change, property: weight, agg: delta, days: 28, unit: lb }
        - { label: Lifts this week, property: lift, agg: count, days: 7, target: 3 }

    - type: line
      title: Weight
      property: weight
      rolling: 7
      unit: lb
      months: 6

    - type: heatmap
      title: Lifting
      property: lift
      color: "#ef4444"
      months: 6

    - type: heatmap
      title: Cardio
      property: cardio
      intensity: miles
      color: "#3b82f6"
      months: 6
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
 * Accepts whatever is in data.json, including the older single-config shape,
 * and returns something the rest of the plugin can rely on.
 */
export function migrate(raw: unknown): DashboardSettings {
	const fallback = defaultSettings();

	if (typeof raw !== "object" || raw === null) return fallback;
	const d = raw as Record<string, unknown>;

	const google = readGoogle(d.google);
	const calendars = readCalendars(d.calendars, google);

	// v0.1: { config: "..." }
	if (typeof d.config === "string" && !Array.isArray(d.dashboards)) {
		const only = makeDashboard("Health", d.config);

		return { dashboards: [only], activeId: only.id, calendars, google };
	}

	if (!Array.isArray(d.dashboards) || d.dashboards.length === 0) return { ...fallback, calendars, google };

	const dashboards: Dashboard[] = [];

	for (const item of d.dashboards) {
		if (typeof item !== "object" || item === null) continue;
		const x = item as Record<string, unknown>;

		if (typeof x.config !== "string") continue;
		dashboards.push({
			id: typeof x.id === "string" && x.id ? x.id : newId(),
			name: typeof x.name === "string" && x.name.trim() ? x.name.trim() : "Untitled",
			config: x.config,
		});
	}

	if (dashboards.length === 0) return { ...fallback, calendars, google };

	const activeId =
		typeof d.activeId === "string" && dashboards.some((x) => x.id === d.activeId)
			? d.activeId
			: dashboards[0].id;

	return { dashboards, activeId, calendars, google };
}

function readGoogle(raw: unknown): GoogleConfig {
	const base = defaultGoogle();

	if (typeof raw !== "object" || raw === null) return base;
	const g = raw as Record<string, unknown>;
	const accounts: GoogleAccountRecord[] = [];
	// v0.2 held a single `account`; anything found there becomes the first entry
	const raws = Array.isArray(g.accounts) ? g.accounts : g.account ? [g.account] : [];

	for (const item of raws) {
		if (typeof item !== "object" || item === null) continue;
		const a = item as Record<string, unknown>;

		if (typeof a.refreshToken !== "string" || !a.refreshToken) continue;
		accounts.push({
			id: typeof a.id === "string" && a.id ? a.id : newId(),
			email: typeof a.email === "string" ? a.email : undefined,
			accessToken: typeof a.accessToken === "string" ? a.accessToken : "",
			refreshToken: a.refreshToken,
			expiresAt: typeof a.expiresAt === "number" ? a.expiresAt : 0,
		});
	}

	return {
		clientId: typeof g.clientId === "string" ? g.clientId : "",
		clientSecret: typeof g.clientSecret === "string" ? g.clientSecret : "",
		port: typeof g.port === "number" && g.port > 0 ? g.port : base.port,
		accounts,
	};
}

function readCalendars(raw: unknown, google: GoogleConfig): CalendarSource[] {
	if (!Array.isArray(raw)) return [];
	const out: CalendarSource[] = [];

	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const x = item as Record<string, unknown>;
		const type = x.type === "google" ? "google" : "ics";
		const url = typeof x.url === "string" ? x.url.trim() : "";
		const calendarId = typeof x.calendarId === "string" ? x.calendarId.trim() : "";

		// a source with nothing to point at cannot be loaded
		if (type === "ics" && !url) continue;

		if (type === "google" && !calendarId) continue;
		out.push({
			id: typeof x.id === "string" && x.id ? x.id : newId(),
			name: typeof x.name === "string" && x.name.trim() ? x.name.trim() : "Calendar",
			type,
			url: url || undefined,
			accountId:
				type === "google"
					? typeof x.accountId === "string" && x.accountId
						? x.accountId
						: google.accounts[0]?.id
					: undefined,
			calendarId: calendarId || undefined,
			writable: x.writable === true,
			color: typeof x.color === "string" ? x.color : undefined,
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
