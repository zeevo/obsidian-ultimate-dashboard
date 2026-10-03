import { DayRecord } from "../data";
import { shiftDate, shiftMonths, today } from "../dates";
import { Field, FieldKind } from "../schema";
import { Ranged } from "./types";

/**
 * A date window, shared by the widgets that plot over time. `back` looks
 * backwards from today; `ahead` on an agenda looks forwards. They used to share
 * the name `days`, which meant opposite things on different widgets.
 */
export const RANGE_FIELDS: readonly Field<Ranged>[] = [
	{ key: "year", kind: FieldKind.Number, label: "Year", min: 1970 },
	{ key: "months", kind: FieldKind.Number, label: "Months back" },
	{ key: "back", kind: FieldKind.Number, label: "Days back" },
	{ key: "from", kind: FieldKind.Date, label: "From" },
	{ key: "to", kind: FieldKind.Date, label: "To" },
];

export const RANGE_KEYS = ["year", "months", "back", "from", "to"] as const;

/** Ranges are mutually exclusive, and a window must run forwards. */
export function validateRange(widget: Ranged): string | null {
	const set = RANGE_KEYS.filter(
		(k) => k !== "to" && widget[k as keyof Ranged] !== undefined,
	);

	const named = set.map((k) => (k === "from" ? "from/to" : k));

	if (named.length > 1) return `pick one range only, got ${named.join(" and ")}`;

	if (widget.from && widget.to && widget.from > widget.to) {
		return `\`from\` (${widget.from}) is after \`to\` (${widget.to})`;
	}

	return null;
}

/**
 * The date window a widget covers. `fallback` decides what an unset range means:
 * a heatmap needs a concrete year to draw, a line chart just plots everything.
 */
export interface DateWindow {
	start: string;
	end: string;
}

export function resolveWindow(range: Ranged, days: DayRecord[], fallback: "year" | "all"): DateWindow {
	const now = today();

	if (range.from !== undefined || range.to !== undefined) {
		return {
			start: range.from ?? (days.length ? days[0].date : now),
			end: range.to ?? now,
		};
	}

	if (range.months !== undefined) {
		return { start: shiftDate(shiftMonths(now, -range.months), 1), end: now };
	}

	if (range.back !== undefined) {
		return { start: shiftDate(now, -(range.back - 1)), end: now };
	}

	if (range.year !== undefined) {
		return { start: `${range.year}-01-01`, end: `${range.year}-12-31` };
	}

	if (fallback === "year") {
		const y = new Date().getFullYear();

		return { start: `${y}-01-01`, end: `${y}-12-31` };
	}

	return {
		start: days.length ? days[0].date : now,
		end: days.length ? days[days.length - 1].date : now,
	};
}
