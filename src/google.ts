import { Platform, requestUrl } from "obsidian";

/**
 * Google Calendar over OAuth 2.0.
 *
 * Full Calendar ships its own client id and routes the token exchange through a
 * hosted proxy so its users skip the Google Cloud setup. This plugin has no
 * proxy to offer, so it uses your own OAuth client of type "Desktop app" with a
 * loopback redirect and PKCE. That keeps every credential on this machine.
 *
 * CalDAV is not used: Google disabled Basic Auth for it in March 2025, and once
 * a token exists the REST API is a better tool than XML over the same auth.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const API = "https://www.googleapis.com/calendar/v3";

const SCOPES = [
	"https://www.googleapis.com/auth/calendar.events",
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export interface GoogleTokens {
	accessToken: string;
	refreshToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
	email?: string;
}

export interface GoogleClient {
	clientId: string;
	clientSecret: string;
}

/* ------------------------------------------------------------------ PKCE */

function randomVerifier(): string {
	const bytes = new Uint8Array(64);
	crypto.getRandomValues(bytes);

	return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
	let s = "";

	for (const b of bytes) s += String.fromCharCode(b);

	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

	return base64url(new Uint8Array(digest));
}

/* --------------------------------------------------------- loopback flow */

/** Electron's CommonJS require, present on desktop only. */
type NodeRequire = (id: "http") => typeof import("http");

/** Serves one request on 127.0.0.1 and resolves with the OAuth code. */
async function awaitCode(port: number): Promise<{ code: string; close: () => void }> {
	// A lazy require, not a top level import: on mobile there is no node http and
	// a module-level require would break plugin load entirely. A dynamic import()
	// is no good either, since Obsidian loads plugins as CommonJS and a bare
	// specifier does not resolve through the renderer's ESM loader.
	const nodeRequire = (globalThis as { require?: NodeRequire }).require;

	if (typeof nodeRequire !== "function") {
		throw new Error("Connecting a Google account needs the desktop app.");
	}

	const http = nodeRequire("http");

	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(
				`<html><body style="font-family:system-ui;padding:3rem;text-align:center">` +
					`<h2>${code ? "Connected" : "Authorisation failed"}</h2>` +
					`<p>${code ? "You can close this tab and return to Obsidian." : String(error)}</p>` +
					`</body></html>`,
			);

			if (code) resolve({ code, close: () => server.close() });
			else {
				server.close();
				reject(new Error(error ?? "no code returned"));
			}
		});

		server.on("error", reject);
		server.listen(port, "127.0.0.1");

		// don't leave a listener open if the user abandons the browser tab
		setTimeout(
			() => {
				server.close();
				reject(new Error("timed out waiting for Google to redirect back"));
			},
			5 * 60 * 1000,
		);
	});
}

export function redirectUri(port: number): string {
	return `http://127.0.0.1:${port}/callback`;
}

/**
 * Opens Google's consent screen and waits for the redirect. Desktop only: the
 * loopback listener needs node's http module.
 */
export async function connect(client: GoogleClient, port: number): Promise<GoogleTokens> {
	if (!Platform.isDesktopApp) {
		throw new Error("Connecting a Google account needs the desktop app.");
	}

	const verifier = randomVerifier();
	const challenge = await challengeFor(verifier);
	const redirect = redirectUri(port);

	const url =
		`${AUTH_ENDPOINT}?client_id=${encodeURIComponent(client.clientId)}` +
		`&redirect_uri=${encodeURIComponent(redirect)}` +
		`&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
		`&code_challenge=${challenge}&code_challenge_method=S256` +
		`&access_type=offline&prompt=consent`;

	const pending = awaitCode(port);
	window.open(url, "_blank");
	const { code, close } = await pending;

	try {
		return await exchange(client, code, verifier, redirect);
	} finally {
		close();
	}
}

async function postForm(body: Record<string, string>): Promise<Record<string, unknown>> {
	const res = await requestUrl({
		url: TOKEN_ENDPOINT,
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body).toString(),
		throw: false,
	});

	const json = res.json as Record<string, unknown>;

	if (res.status < 200 || res.status >= 300) {
		const detail = typeof json?.error_description === "string" ? json.error_description : res.status;

		throw new Error(`Google rejected the request: ${detail}`);
	}

	return json;
}

async function exchange(
	client: GoogleClient,
	code: string,
	verifier: string,
	redirect: string,
): Promise<GoogleTokens> {
	const json = await postForm({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		code,
		code_verifier: verifier,
		grant_type: "authorization_code",
		redirect_uri: redirect,
	});

	const tokens: GoogleTokens = {
		accessToken: String(json.access_token ?? ""),
		refreshToken: String(json.refresh_token ?? ""),
		expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
	};

	if (!tokens.refreshToken) {
		throw new Error(
			"Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.",
		);
	}

	tokens.email = await fetchEmail(tokens.accessToken);

	return tokens;
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
	const res = await requestUrl({
		url: "https://openidconnect.googleapis.com/v1/userinfo",
		headers: { Authorization: `Bearer ${accessToken}` },
		throw: false,
	});

	if (res.status !== 200) return undefined;
	const email = (res.json as Record<string, unknown>)?.email;

	return typeof email === "string" ? email : undefined;
}

/** Returns a valid access token, refreshing a minute before it lapses. */
export async function validToken(
	client: GoogleClient,
	tokens: GoogleTokens,
	onRefresh: (t: GoogleTokens) => Promise<void>,
): Promise<string> {
	if (tokens.accessToken && Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;

	const json = await postForm({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		refresh_token: tokens.refreshToken,
		grant_type: "refresh_token",
	});

	const refreshed: GoogleTokens = {
		...tokens,
		accessToken: String(json.access_token ?? ""),
		expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
	};

	await onRefresh(refreshed);

	return refreshed.accessToken;
}

/* --------------------------------------------------------------- the API */

export interface GoogleCalendarInfo {
	id: string;
	summary: string;
	primary: boolean;
	backgroundColor?: string;
	/** Google's accessRole: owner, writer, reader or freeBusyReader. */
	accessRole: string;
	/** Whether this account may create events here. */
	writable: boolean;
}

async function apiGet(accessToken: string, path: string): Promise<Record<string, unknown>> {
	const res = await requestUrl({
		url: `${API}${path}`,
		headers: { Authorization: `Bearer ${accessToken}` },
		throw: false,
	});

	if (res.status === 401) throw new Error("Google rejected the token. Reconnect the account.");

	if (res.status < 200 || res.status >= 300) throw new Error(`Google answered ${res.status}`);

	return res.json as Record<string, unknown>;
}

export async function listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
	const json = await apiGet(accessToken, "/users/me/calendarList?maxResults=250");
	const items = Array.isArray(json.items) ? json.items : [];
	const out: GoogleCalendarInfo[] = [];

	for (const raw of items) {
		const c = raw as Record<string, unknown>;

		if (typeof c.id !== "string") continue;
		// Shared calendars like "Phases of the Moon" come back as reader, and a
		// create against them is a 403. Only owner and writer can take events.
		const accessRole = typeof c.accessRole === "string" ? c.accessRole : "reader";

		out.push({
			id: c.id,
			summary: typeof c.summary === "string" ? c.summary : c.id,
			primary: c.primary === true,
			backgroundColor: typeof c.backgroundColor === "string" ? c.backgroundColor : undefined,
			accessRole,
			writable: accessRole === "owner" || accessRole === "writer",
		});
	}

	return out;
}

export interface GoogleEvent {
	summary: string;
	location?: string;
	start: Date;
	end: Date;
	allDay: boolean;
}

function readStamp(node: unknown): { date: Date; allDay: boolean } | null {
	if (typeof node !== "object" || node === null) return null;
	const n = node as Record<string, unknown>;

	if (typeof n.dateTime === "string") return { date: new Date(n.dateTime), allDay: false };

	if (typeof n.date === "string") {
		const [y, m, d] = n.date.split("-").map(Number);

		return { date: new Date(y, m - 1, d), allDay: true };
	}

	return null;
}

export async function listEvents(
	accessToken: string,
	calendarId: string,
	from: Date,
	to: Date,
): Promise<GoogleEvent[]> {
	// singleEvents makes Google expand recurrence for us, which is the main
	// reason the REST API beats parsing an ICS feed by hand.
	const path =
		`/calendars/${encodeURIComponent(calendarId)}/events` +
		`?singleEvents=true&orderBy=startTime&maxResults=250` +
		`&timeMin=${encodeURIComponent(from.toISOString())}` +
		`&timeMax=${encodeURIComponent(to.toISOString())}`;

	const json = await apiGet(accessToken, path);
	const items = Array.isArray(json.items) ? json.items : [];
	const out: GoogleEvent[] = [];

	for (const raw of items) {
		const e = raw as Record<string, unknown>;
		const start = readStamp(e.start);
		const end = readStamp(e.end);

		if (!start) continue;
		out.push({
			summary: typeof e.summary === "string" ? e.summary : "(no title)",
			location: typeof e.location === "string" ? e.location : undefined,
			start: start.date,
			end: end?.date ?? new Date(start.date.getTime() + 3600000),
			allDay: start.allDay,
		});
	}

	return out;
}

export interface NewEvent {
	summary: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location?: string;
	description?: string;
}

const localDate = (d: Date) => {
	const p = (n: number) => String(n).padStart(2, "0");

	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function insertEvent(
	accessToken: string,
	calendarId: string,
	event: NewEvent,
): Promise<void> {
	const body = {
		summary: event.summary,
		location: event.location,
		description: event.description,
		start: event.allDay
			? { date: localDate(event.start) }
			: { dateTime: event.start.toISOString() },
		end: event.allDay ? { date: localDate(event.end) } : { dateTime: event.end.toISOString() },
	};

	const res = await requestUrl({
		url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		throw: false,
	});

	if (res.status === 401) throw new Error("Google rejected the token. Reconnect the account.");

	if (res.status === 403) throw new Error("403 forbidden. This calendar may be read only.");

	if (res.status < 200 || res.status >= 300) throw new Error(`Google answered ${res.status}`);
}
