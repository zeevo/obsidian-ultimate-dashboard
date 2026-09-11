/**
 * Field schemas.
 *
 * A panel declares its fields once. Parsing, serialising and the configuration
 * form are all derived from that declaration, so adding a field is a one line
 * change instead of three edits that have to stay in lockstep. Forgetting to
 * write a field back was the failure this removes: it is silent, and it loses
 * data the next time anyone edits the dashboard.
 */

import { assertNever } from "./kinds";

export const FieldKind = {
	Text: "text",
	Number: "number",
	Toggle: "toggle",
	/** Text, offered with the frontmatter keys present in the vault. */
	Property: "property",
	Colour: "colour",
	/** A YYYY-MM string. */
	Month: "month",
	/** A YYYY-MM-DD string. */
	Date: "date",
	/** Names chosen from the configured calendars. */
	Calendars: "calendars",
	/** One of a fixed set of values. */
	Choice: "choice",
} as const;

export type FieldKind = (typeof FieldKind)[keyof typeof FieldKind];

export type FieldValue = string | number | boolean | readonly string[];

export class FieldError extends Error {}

interface Common<P> {
	/** Typed against the panel it belongs to, so a rename cannot drift. */
	readonly key: Extract<keyof P, string>;
	readonly label: string;
	readonly hint?: string;
	readonly required?: boolean;
}

export interface TextField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Text | typeof FieldKind.Property | typeof FieldKind.Colour;
	readonly placeholder?: string;
}

export interface NumberField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Number;
	/** Rejected below this. Defaults to 1, since every numeric option is a count. */
	readonly min?: number;
	readonly integer?: boolean;
}

export interface ToggleField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Toggle;
}

export interface StampField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Month | typeof FieldKind.Date;
}

export interface CalendarsField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Calendars;
}

export interface ChoiceField<P> extends Common<P> {
	readonly kind: typeof FieldKind.Choice;
	readonly choices: readonly { readonly value: string; readonly label: string }[];
}

export type Field<P> =
	| TextField<P>
	| NumberField<P>
	| ToggleField<P>
	| StampField<P>
	| CalendarsField<P>
	| ChoiceField<P>;

const MONTH = /^\d{4}-\d{2}$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YAML turns an unquoted date into a Date, so accept both shapes. */
function asStamp(v: unknown): string {
	if (v instanceof Date) {
		const p = (n: number) => String(n).padStart(2, "0");

		return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
	}

	return String(v).trim();
}

/** Reads one declared field off raw YAML, or throws saying which and why. */
function readField<P>(field: Field<P>, raw: unknown, where: string): FieldValue | undefined {
	const at = `${where} \`${field.key}\``;

	if (raw === undefined || raw === null) return undefined;

	switch (field.kind) {
		case FieldKind.Text:
		case FieldKind.Property:
		case FieldKind.Colour: {
			if (typeof raw !== "string" || !raw.trim()) {
				throw new FieldError(`${at} must be a non-empty string`);
			}

			return raw.trim();
		}

		case FieldKind.Number: {
			if (typeof raw !== "number" || !Number.isFinite(raw)) {
				throw new FieldError(`${at} must be a number`);
			}

			if (field.integer !== false && !Number.isInteger(raw)) {
				throw new FieldError(`${at} must be a whole number`);
			}

			const min = field.min ?? 1;

			if (raw < min) throw new FieldError(`${at} must be at least ${min}`);

			return raw;
		}

		case FieldKind.Toggle: {
			if (typeof raw !== "boolean") throw new FieldError(`${at} must be true or false`);

			return raw;
		}

		case FieldKind.Month: {
			const s = asStamp(raw).slice(0, 7);

			if (!MONTH.test(s)) throw new FieldError(`${at} must look like 2026-09`);

			return s;
		}

		case FieldKind.Date: {
			const s = asStamp(raw);

			if (!DATE.test(s)) throw new FieldError(`${at} must look like 2026-09-30`);

			return s;
		}

		case FieldKind.Calendars: {
			if (!Array.isArray(raw) || raw.some((c) => typeof c !== "string")) {
				throw new FieldError(`${at} must be a list of calendar names`);
			}

			return (raw as string[]).map((c) => c.trim()).filter(Boolean);
		}

		case FieldKind.Choice: {
			const s = String(raw);

			if (!field.choices.some((c) => c.value === s)) {
				throw new FieldError(
					`${at} must be one of ${field.choices.map((c) => c.value).join(", ")}`,
				);
			}

			return s;
		}

		default:
			return assertNever(field, "readField");
	}
}

/** Every declared field, validated. Unknown keys are reported, not ignored. */
export function parseFields<P>(
	fields: readonly Field<P>[],
	raw: Record<string, unknown>,
	where: string,
	reserved: readonly string[],
): Record<string, FieldValue> {
	const out: Record<string, FieldValue> = {};
	const known = new Set<string>([...fields.map((f) => f.key), ...reserved]);

	for (const key of Object.keys(raw)) {
		if (!known.has(key)) {
			throw new FieldError(
				`${where}: unknown option \`${key}\`. Expected one of ${[...known].sort().join(", ")}`,
			);
		}
	}

	for (const field of fields) {
		const value = readField(field, raw[field.key], where);

		if (value !== undefined) out[field.key] = value;
		else if (field.required) throw new FieldError(`${where}: \`${field.key}\` is required`);
	}

	return out;
}

/** Whether every required field is present and non-empty. */
export function isComplete<P>(fields: readonly Field<P>[], node: P): boolean {
	for (const field of fields) {
		if (!field.required) continue;
		const v = (node as Record<string, unknown>)[field.key];

		if (v === undefined || v === null || v === "") return false;
	}

	return true;
}
