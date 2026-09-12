/**
 * The discriminants for every node in a layout.
 *
 * `as const` objects rather than enums: the constants are named, so a typo is a
 * compile error and renaming is mechanical, but they erase to plain strings and
 * carry no runtime baggage. The string values are what land in YAML.
 */

export const ContainerKind = {
	Row: "row",
	Column: "column",
} as const;

export type ContainerKind = (typeof ContainerKind)[keyof typeof ContainerKind];

export const WidgetKind = {
	Stat: "stat",
	Line: "line",
	Heatmap: "heatmap",
	Upcoming: "upcoming",
	Calendar: "calendar",
	Note: "note",
	Blank: "blank",
} as const;

export type WidgetKind = (typeof WidgetKind)[keyof typeof WidgetKind];

export const CONTAINER_KINDS = Object.values(ContainerKind);

export const WIDGET_KINDS = Object.values(WidgetKind);

export function toContainerKind(v: unknown): ContainerKind | null {
	return CONTAINER_KINDS.find((k) => k === v) ?? null;
}

export function toWidgetKind(v: unknown): WidgetKind | null {
	return WIDGET_KINDS.find((k) => k === v) ?? null;
}

/**
 * Fails to compile if a switch over a union misses a case. Call it from the
 * default branch: adding a kind then surfaces every place that must handle it.
 */
export function assertNever(value: never, context: string): never {
	throw new Error(`${context}: unhandled ${JSON.stringify(value)}`);
}
