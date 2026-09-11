import { App } from "obsidian";

/** One daily note, keyed by its filename date. */
export interface DayRecord {
	date: string;
	props: Record<string, unknown>;
}

const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every note in `folder` whose filename is a plain YYYY-MM-DD date, sorted
 * oldest first. Frontmatter comes from the metadata cache, so this stays in
 * step with edits without re-reading files.
 */
export function readDays(app: App, folder: string): DayRecord[] {
	const prefix = folder.replace(/\/+$/, "") + "/";
	const days: DayRecord[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix)) continue;

		if (!DATE_NAME.test(file.basename)) continue;
		days.push({
			date: file.basename,
			props: app.metadataCache.getFileCache(file)?.frontmatter ?? {},
		});
	}

	days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	return days;
}

/** Numeric value of a property, or null when absent or non-numeric. */
export function num(day: DayRecord, key: string): number | null {
	const v = day.props[key];

	if (typeof v === "number" && Number.isFinite(v)) return v;

	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);

		if (Number.isFinite(n)) return n;
	}

	return null;
}

/**
 * Whether a property counts as "logged" for that day. Booleans use their own
 * value; anything else counts when it is present and not empty. `false` never
 * counts, so an explicitly unticked day is not a logged day.
 */
export function truthy(day: DayRecord, key: string): boolean {
	const v = day.props[key];

	if (v === null || v === undefined) return false;

	if (typeof v === "boolean") return v;

	if (typeof v === "string") return v.trim() !== "" && v.trim().toLowerCase() !== "false";

	if (typeof v === "number") return v !== 0;

	return true;
}

/** ISO date `n` days from `iso`, negative to go back. */
export function shiftDate(iso: string, n: number): string {
	const d = new Date(iso + "T00:00:00");
	d.setDate(d.getDate() + n);

	return toISO(d);
}

export function toISO(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");

	return `${d.getFullYear()}-${m}-${day}`;
}

export function today(): string {
	return toISO(new Date());
}

/** ISO date `n` months from `iso`, clamping to the shorter month. */
export function shiftMonths(iso: string, n: number): string {
	const d = new Date(iso + "T00:00:00");
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + n);
	const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, lastOfMonth));

	return toISO(d);
}

/** Whole days from `a` to `b`, inclusive of both ends. */
export function daysBetween(a: string, b: string): number {
	const ms = (iso: string) => new Date(iso + "T00:00:00").getTime();

	return Math.round((ms(b) - ms(a)) / 86400000) + 1;
}
