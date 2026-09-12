import { requestUrl } from "obsidian";
import { CalEvent, parseICS } from "./ics";
import { GoogleAccountRecord, GoogleConfig, CalendarSource, findAccount } from "./store";
import { NewEvent, insertEvent, listEvents, validToken } from "./google";

export interface DatedEvent extends CalEvent {
	calendar: string;
	color?: string;
}

interface CacheEntry {
	fetchedAt: number;
	text: string;
}

const TTL_MS = 10 * 60 * 1000;

/**
 * Fetches and caches calendar feeds. Uses Obsidian's `requestUrl` rather than
 * `fetch`, because the renderer enforces CORS and calendar hosts do not send
 * the headers that would allow it.
 */
/** Everything the service needs to reach any connected Google account. */
export interface GoogleAccess {
	config: GoogleConfig;
	saveTokens: (accountId: string, t: GoogleAccountRecord) => Promise<void>;
}

export class CalendarService {
	private cache = new Map<string, CacheEntry>();
	private inflight = new Map<string, Promise<string>>();
	private google: (() => GoogleAccess) | null = null;

	/** Supplies Google credentials lazily, so the plugin owns the settings. */
	useGoogle(access: () => GoogleAccess): void {
		this.google = access;
	}

	/** Drops cached feeds so the next read goes to the network. */
	invalidate(): void {
		this.cache.clear();
		this.inflight.clear();
	}

	private async fetchText(url: string): Promise<string> {
		const hit = this.cache.get(url);

		if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.text;

		const running = this.inflight.get(url);

		if (running) return running;

		const job = (async () => {
			// webcal:// is the same feed over https
			const target = url.replace(/^webcal:\/\//i, "https://");
			const res = await requestUrl({ url: target, method: "GET" });
			const text = res.text;
			this.cache.set(url, { fetchedAt: Date.now(), text });
			this.inflight.delete(url);

			return text;
		})().catch((e) => {
			this.inflight.delete(url);
			throw e;
		});

		this.inflight.set(url, job);

		return job;
	}

	/**
	 * Events from the named sources between two dates. A source that fails to
	 * load is reported rather than throwing, so one broken feed cannot blank a
	 * widget that also draws working ones.
	 */
	async events(
		sources: CalendarSource[],
		from: Date,
		to: Date,
	): Promise<{ events: DatedEvent[]; errors: string[] }> {
		const events: DatedEvent[] = [];
		const errors: string[] = [];

		await Promise.all(
			sources.map(async (source) => {
				try {
					if (source.type === "google") {
						for (const e of await this.googleEvents(source, from, to)) {
							events.push({ ...e, calendar: source.name, color: source.color });
						}

						return;
					}

					const text = await this.fetchText(source.url ?? "");

					for (const e of parseICS(text, from, to)) {
						events.push({ ...e, calendar: source.name, color: source.color });
					}
				} catch (e) {
					// SAFETY: requestUrl rejects with an Error; the fallback below covers
					// anything else that reaches here without a message.
					errors.push(`${source.name}: ${(e as Error).message || "could not load"}`);
				}
			}),
		);

		events.sort((a, b) => a.start.getTime() - b.start.getTime());

		return { events, errors };
	}

	/** Google expands recurrence server-side, so nothing needs parsing here. */
	private async googleEvents(source: CalendarSource, from: Date, to: Date) {
		const token = await this.tokenFor(source.accountId);

		return listEvents(token, source.calendarId ?? "primary", from, to);
	}

	/** A live access token for one connected account. */
	private async tokenFor(accountId?: string): Promise<string> {
		const access = this.google?.();

		if (!access) throw new Error("no Google account connected");
		const account = findAccount(access.config, accountId);

		if (!account) throw new Error("that Google account is no longer connected");

		return validToken(access.config, account, async (t) => {
			await access.saveTokens(account.id, { ...account, ...t });
		});
	}

	/** Creates an event on a writable Google calendar. */
	async create(accountId: string, calendarId: string, event: NewEvent): Promise<void> {
		const token = await this.tokenFor(accountId);

		await insertEvent(token, calendarId, event);
		// the new event will not appear until the cached window is dropped
		this.invalidate();
	}
}
