/**
 * A small iCalendar reader. Handles what a subscribed calendar feed actually
 * contains: folded lines, all-day and timed events, and the common recurrence
 * rules. It is deliberately not a complete RFC 5545 implementation.
 */

export interface CalEvent {
	summary: string;
	location?: string;
	/** Local start. For all-day events the time is midnight. */
	start: Date;
	end: Date;
	allDay: boolean;
}

/** Joins continuation lines, which begin with a space or tab. */
function unfold(text: string): string[] {
	const out: string[] = [];

	for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
		if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
			out[out.length - 1] += raw.slice(1);
		} else {
			out.push(raw);
		}
	}

	return out;
}

interface Prop {
	name: string;
	params: Record<string, string>;
	value: string;
}

function parseLine(line: string): Prop | null {
	const colon = line.indexOf(":");

	if (colon < 0) return null;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const parts = head.split(";");
	const params: Record<string, string> = {};

	for (const p of parts.slice(1)) {
		const eq = p.indexOf("=");

		if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
	}

	return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(v: string): string {
	return v
		.replace(/\\n/gi, " ")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

/**
 * Parses an ICS timestamp. A trailing Z is UTC; anything else, including a
 * TZID, is read as local time. Without a timezone database a TZID cannot be
 * resolved properly, and local is far closer than pretending it is UTC.
 */
function parseDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
	const v = value.trim();
	const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);

	if (dateOnly) {
		const [, y, m, d] = dateOnly;

		return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
	}

	const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);

	if (!full) return null;
	const [, y, m, d, hh, mm, ss, z] = full;
	const n = (x: string) => Number(x);

	const date = z
		? new Date(Date.UTC(n(y), n(m) - 1, n(d), n(hh), n(mm), n(ss)))
		: new Date(n(y), n(m) - 1, n(d), n(hh), n(mm), n(ss));

	return { date, allDay: params.VALUE === "DATE" };
}

const DAY_MS = 86400000;

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

interface Rule {
	freq: string;
	interval: number;
	count?: number;
	until?: Date;
	byday: number[];
}

function parseRule(value: string): Rule | null {
	const parts: Record<string, string> = {};

	for (const kv of value.split(";")) {
		const eq = kv.indexOf("=");

		if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
	}

	if (!parts.FREQ) return null;
	const until = parts.UNTIL ? parseDate(parts.UNTIL, {}) : null;

	return {
		freq: parts.FREQ.toUpperCase(),
		interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
		count: parts.COUNT ? Number(parts.COUNT) : undefined,
		until: until?.date,
		// strip any ordinal prefix, so "2MO" is treated as Monday
		byday: (parts.BYDAY ?? "")
			.split(",")
			.map((d) => WEEKDAYS.indexOf(d.replace(/^[-+]?\d+/, "").toUpperCase()))
			.filter((i) => i >= 0),
	};
}

/**
 * The nth occurrence of a rule, counted from the original start. Monthly and
 * yearly rules keep the original day of the month and skip months too short to
 * hold it, which is what RFC 5545 requires: a monthly event on the 31st does
 * not slide to the 28th in February, it simply does not occur.
 */
function occurrence(base: Date, rule: Rule, n: number): Date | null {
	if (rule.freq === "DAILY") return new Date(base.getTime() + n * rule.interval * DAY_MS);

	if (rule.freq === "WEEKLY") return new Date(base.getTime() + n * rule.interval * 7 * DAY_MS);

	if (rule.freq !== "MONTHLY" && rule.freq !== "YEARLY") return null;

	const step = rule.interval * n * (rule.freq === "YEARLY" ? 12 : 1);
	const day = base.getDate();
	const d = new Date(base);
	d.setDate(1);
	d.setMonth(d.getMonth() + step);
	const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

	if (day > lastOfMonth) return null;
	d.setDate(day);

	return d;
}

/** Occurrences of a recurring event that fall inside [from, to]. */
function expand(base: CalEvent, rule: Rule, from: Date, to: Date): CalEvent[] {
	const out: CalEvent[] = [];
	const duration = base.end.getTime() - base.start.getTime();
	const limit = rule.until && rule.until < to ? rule.until : to;
	let emitted = 0;

	// generous ceiling: stops a malformed rule from looping forever
	for (let n = 0; n < 2000; n++) {
		if (rule.count !== undefined && emitted >= rule.count) break;

		const anchor = occurrence(base.start, rule, n);

		if (anchor === null) {
			// a month too short for this day; keep stepping
			if (rule.freq === "MONTHLY" || rule.freq === "YEARLY") continue;
			break;
		}

		if (anchor > limit) break;

		const candidates: Date[] = [];

		if (rule.freq === "WEEKLY" && rule.byday.length > 0) {
			const weekStart = new Date(anchor);
			weekStart.setDate(weekStart.getDate() - weekStart.getDay());

			for (const dow of rule.byday) {
				const d = new Date(weekStart);
				d.setDate(d.getDate() + dow);
				d.setHours(base.start.getHours(), base.start.getMinutes(), base.start.getSeconds(), 0);
				candidates.push(d);
			}

			candidates.sort((a, b) => a.getTime() - b.getTime());
		} else {
			candidates.push(anchor);
		}

		for (const start of candidates) {
			if (start < base.start) continue;

			if (rule.until && start > rule.until) continue;

			if (rule.count !== undefined && emitted >= rule.count) break;
			emitted++;

			if (start >= from && start <= to) {
				out.push({ ...base, start, end: new Date(start.getTime() + duration) });
			}
		}
	}

	return out;
}

/** Every event, recurrences expanded, that overlaps [from, to]. */
export function parseICS(text: string, from: Date, to: Date): CalEvent[] {
	const events: CalEvent[] = [];
	let inEvent = false;
	let cur: Partial<CalEvent> & { rrule?: string; exdates?: number[] } = {};

	for (const line of unfold(text)) {
		if (line === "BEGIN:VEVENT") {
			inEvent = true;
			cur = { exdates: [] };
			continue;
		}

		if (line === "END:VEVENT") {
			inEvent = false;

			if (cur.start && cur.summary !== undefined) {
				const base: CalEvent = {
					summary: cur.summary,
					location: cur.location,
					start: cur.start,
					end: cur.end ?? new Date(cur.start.getTime() + (cur.allDay ? DAY_MS : 3600000)),
					allDay: cur.allDay ?? false,
				};

				const rule = cur.rrule ? parseRule(cur.rrule) : null;
				const excluded = new Set(cur.exdates ?? []);
				const produced = rule ? expand(base, rule, from, to) : [base];

				for (const e of produced) {
					if (excluded.has(e.start.getTime())) continue;

					if (e.end >= from && e.start <= to) events.push(e);
				}
			}

			continue;
		}

		if (!inEvent) continue;

		const prop = parseLine(line);

		if (!prop) continue;

		switch (prop.name) {
			case "SUMMARY":
				cur.summary = unescapeText(prop.value);
				break;
			case "LOCATION":
				cur.location = unescapeText(prop.value);
				break;
			case "DTSTART": {
				const d = parseDate(prop.value, prop.params);

				if (d) {
					cur.start = d.date;
					cur.allDay = d.allDay;
				}

				break;
			}

			case "DTEND": {
				const d = parseDate(prop.value, prop.params);

				if (d) cur.end = d.date;
				break;
			}

			case "RRULE":
				cur.rrule = prop.value;
				break;
			case "EXDATE": {
				for (const piece of prop.value.split(",")) {
					const d = parseDate(piece, prop.params);

					if (d) cur.exdates?.push(d.date.getTime());
				}

				break;
			}
		}
	}

	return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}
