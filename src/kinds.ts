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

export const PanelKind = {
	Stat: "stat",
	Line: "line",
	Heatmap: "heatmap",
	Upcoming: "upcoming",
	Calendar: "calendar",
	Note: "note",
	Blank: "blank",
} as const;

export type PanelKind = (typeof PanelKind)[keyof typeof PanelKind];

export const CONTAINER_KINDS = Object.values(ContainerKind);

export const PANEL_KINDS = Object.values(PanelKind);

export function toContainerKind(v: unknown): ContainerKind | null {
	return CONTAINER_KINDS.find((k) => k === v) ?? null;
}

export function toPanelKind(v: unknown): PanelKind | null {
	return PANEL_KINDS.find((k) => k === v) ?? null;
}

/**
 * Fails to compile if a switch over a union misses a case. Call it from the
 * default branch: adding a kind then surfaces every place that must handle it.
 */
export function assertNever(value: never, context: string): never {
	throw new Error(`${context}: unhandled ${JSON.stringify(value)}`);
}
