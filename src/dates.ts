/** Calendar arithmetic and date wording shared across widgets. */

export const DAY_MS = 86400000;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/** "2026-02" as "February 2026", or the current month when unset. */
export function monthName(month?: string): string {
	const date = month
		? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
		: new Date();

	return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "9:05", a 24 hour time without a leading zero on the hour. */
export const hhmm = (d: Date) =>
	`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

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

	return Math.round((ms(b) - ms(a)) / DAY_MS) + 1;
}

/** When an event happens, in words, for its details popup. */
export function eventWhen(e: { start: Date; end: Date; allDay: boolean }): string {
	const long: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
	const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
	const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

	if (e.allDay) {
		// an all day event ends at midnight after its last day
		const last = new Date(e.end.getTime() - 1);

		if (last <= e.start || sameDay(e.start, last)) return `${e.start.toLocaleDateString([], long)}, all day`;

		return `${e.start.toLocaleDateString([], short)} \u2013 ${last.toLocaleDateString([], { ...short, year: "numeric" })}, all day`;
	}

	if (sameDay(e.start, e.end)) {
		return `${e.start.toLocaleDateString([], long)}, ${time(e.start)} \u2013 ${time(e.end)}`;
	}

	return (
		`${e.start.toLocaleDateString([], short)}, ${time(e.start)} \u2013 ` +
		`${e.end.toLocaleDateString([], short)}, ${time(e.end)}`
	);
}
