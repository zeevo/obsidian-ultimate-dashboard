import { parseYaml } from "obsidian";
import { ContainerKind, assertNever, toContainerKind, toPanelKind } from "./kinds";
import { NodeBase, Panel, specFor } from "./panels";
import { FieldError, isComplete, parseFields } from "./schema";

/**
 * The layout document: parsing, and the tree it produces.
 *
 * Panel options are not parsed here. Each panel declares its fields in the
 * registry and this walks that declaration, so a new panel type needs no change
 * to this file.
 */

export interface ContainerNode extends NodeBase {
	type: ContainerKind;
	children: LayoutNode[];
	/** Space between children, in pixels. Inherited from the parent if unset. */
	gap?: number;
	/** Row only: whether children wrap onto further lines. Defaults to true. */
	wrap?: boolean;
}

export type LayoutNode = ContainerNode | Panel;

export interface Dashboard {
	/** Folder holding the dated notes every panel reads. */
	folder: string;
	root: ContainerNode;
}

export class ConfigError extends Error {}

export function isContainer(node: LayoutNode): node is ContainerNode {
	return toContainerKind(node.type) !== null;
}

const MAX_DEPTH = 8;

let counter = 0;

/** Runtime only, never serialised: identity that survives a re-render. */
export function nextId(): string {
	counter += 1;

	return `n${counter}`;
}

function asRecord(raw: unknown, where: string): Record<string, unknown> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ConfigError(`${where} must be a mapping`);
	}

	return raw as Record<string, unknown>;
}

function readFlex(raw: Record<string, unknown>, where: string): number | undefined {
	const v = raw.flex;

	if (v === undefined || v === null) return undefined;

	if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
		throw new ConfigError(`${where}: \`flex\` must be a number greater than zero`);
	}

	return v;
}

/** Keys handled by the tree rather than by a panel's own field list. */
const STRUCTURAL = ["type", "flex", "children", "gap", "wrap"] as const;

function parseNode(raw: unknown, where: string, depth: number): LayoutNode {
	if (depth > MAX_DEPTH) {
		throw new ConfigError(`${where}: nested deeper than ${MAX_DEPTH} levels`);
	}

	const node = asRecord(raw, where);
	const flex = readFlex(node, where);
	const container = toContainerKind(node.type);

	if (container !== null) {
		if (!Array.isArray(node.children)) {
			throw new ConfigError(`${where}: \`${container}\` needs a \`children\` list`);
		}

		if (container !== ContainerKind.Row && node.wrap !== undefined) {
			throw new ConfigError(`${where}: \`wrap\` only applies to a row`);
		}

		const gap = node.gap;

		if (gap !== undefined && (typeof gap !== "number" || gap < 0)) {
			throw new ConfigError(`${where}: \`gap\` must be a number of pixels`);
		}

		// a container has no field declaration to check against, so its own keys
		// are listed here; without this a typo is silently ignored
		const allowed = new Set(["type", "flex", "children", "gap", "wrap"]);

		for (const key of Object.keys(node)) {
			if (!allowed.has(key)) {
				throw new ConfigError(
					`${where}: unknown option \`${key}\`. A ${container} takes ${[...allowed].join(", ")}`,
				);
			}
		}

		return {
			id: nextId(),
			type: container,
			flex,
			gap: typeof gap === "number" ? gap : undefined,
			wrap: typeof node.wrap === "boolean" ? node.wrap : undefined,
			children: node.children.map((c, i) => parseNode(c, `${where} > ${container}[${i}]`, depth + 1)),
		};
	}

	const panel = toPanelKind(node.type);

	if (panel === null) {
		throw new ConfigError(
			`${where}: unknown type "${String(node.type)}". ` +
				`Expected a panel or a container (row, column).`,
		);
	}

	if (node.children !== undefined) {
		throw new ConfigError(
			`${where}: \`${panel}\` is a panel and cannot have \`children\`. ` +
				`Wrap panels in a row or column instead.`,
		);
	}

	const spec = specFor(panel);
	let fields;

	try {
		fields = parseFields(spec.fields, node, where, STRUCTURAL);
	} catch (e) {
		throw e instanceof FieldError ? new ConfigError(e.message) : e;
	}


	const built: Record<string, unknown> = { id: nextId(), type: panel, flex, ...fields };

	// SAFETY: every key came from this panel's own field declaration, and every
	// value was validated against the kind that declaration names.
	const parsed = built as unknown as Panel;
	const complaint = spec.validate?.(parsed);

	if (complaint) throw new ConfigError(`${where}: ${complaint}`);

	return parsed;
}

export function parseDashboard(source: string): Dashboard {
	let raw: unknown;

	try {
		raw = parseYaml(source);
	} catch (e) {
		throw new ConfigError(`could not parse YAML: ${(e as Error).message}`);
	}

	const doc = asRecord(raw, "the block");

	if (doc.panels !== undefined) {
		throw new ConfigError(
			"`panels` is gone. Use `layout:` with a row or column holding the panels.",
		);
	}

	if (doc.layout === undefined) throw new ConfigError("`layout` is required");
	const root = parseNode(doc.layout, "layout", 0);

	if (!isContainer(root)) {
		throw new ConfigError(`layout: the root must be a row or column, not a "${root.type}" panel`);
	}

	return {
		folder: typeof doc.folder === "string" && doc.folder.trim() ? doc.folder.trim() : "Daily",
		root,
	};
}

/** Whether a panel still needs configuring before it can be drawn. */
export function needsSetup(node: LayoutNode): boolean {
	if (isContainer(node)) return false;

	return !isComplete(specFor(node.type).fields, node);
}

export function countPanels(node: LayoutNode): number {
	return isContainer(node) ? node.children.reduce((n, c) => n + countPanels(c), 0) : 1;
}

export { assertNever };
