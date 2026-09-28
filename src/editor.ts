import { App, Notice, setIcon, setTooltip } from "obsidian";
import { ConfigError, ContainerNode, Dashboard, LayoutNode, isContainer, needsSetup, nextId, parseDashboard } from "./layout-tree";
import { WIDGETS, specFor } from "./widgets";
import { ContainerKind, WidgetKind, toContainerKind, toWidgetKind } from "./kinds";
import { serializeDashboard } from "./serialize";
import { FormContext, WidgetForm } from "./widget-form";

/**
 * The layout editor. Edit mode draws the real dashboard, and this adds handles
 * to it: a grip on every widget, an outlined tab on every row and column, and a
 * palette to drag new pieces from. Every edit mutates the tree and hands it
 * back, so the YAML editor and this one are two views of the same document.
 */

const DIVIDERS = [
	{ type: ContainerKind.Row, label: "Columns", icon: "columns-3", hint: "Split into columns, side by side" },
	{ type: ContainerKind.Column, label: "Rows", icon: "rows-3", hint: "Split into rows, stacked" },
] as const;

/**
 * A fresh node of the given type, carrying only what the parser demands.
 *
 * Each widget declares its own starter in the registry. This used to be a chain
 * of `if`s ending in a bare `return calendar`, which meant a type nobody had
 * added a branch for came out as a Month widget with no error at all.
 */
export function newNode(type: WidgetKind | ContainerKind): LayoutNode {
	const id = nextId();
	const container = toContainerKind(type);

	if (container !== null) return { id, type: container, children: [] };

	const widget = toWidgetKind(type);

	if (widget === null) throw new Error(`newNode: \`${type}\` is neither a container nor a widget`);

	return { id, ...specFor(widget).blank() };
}

/** The label shown on a handle and in the palette. */
function label(type: WidgetKind | ContainerKind): string {
	const divider = DIVIDERS.find((d) => d.type === type);

	if (divider) return divider.label;
	const widget = toWidgetKind(type);

	return widget ? specFor(widget).label : type;
}

/* ---------------------------------------------------------- tree edits */

/** The node a path of child indexes leads to from `root`, or null. */
export function nodeAt(root: ContainerNode, path: number[]): LayoutNode | null {
	let node: LayoutNode = root;

	for (const i of path) {
		if (!isContainer(node)) return null;
		const next: LayoutNode | undefined = node.children[i];

		if (!next) return null;
		node = next;
	}

	return node;
}

/** Whether `haystack` is `needle` or contains it anywhere below. */
function contains(haystack: ContainerNode, needle: LayoutNode): boolean {
	if (haystack === needle) return true;

	for (const child of haystack.children) {
		if (child === needle) return true;

		if (isContainer(child) && contains(child, needle)) return true;
	}

	return false;
}

/**
 * Moves the node at `from` into `parent` at `index`, where `index` counts the
 * parent's children as they were before the move. Returns false, changing
 * nothing, when the move is impossible: a missing node, the root, or a
 * container dropped inside itself.
 */
export function moveNode(root: ContainerNode, from: number[], parent: ContainerNode, index: number): boolean {
	if (from.length === 0) return false;

	const moving = nodeAt(root, from);
	const source = nodeAt(root, from.slice(0, -1));

	if (!moving || !source || !isContainer(source)) return false;

	if (isContainer(moving) && contains(moving, parent)) return false;

	const oldIndex = from[from.length - 1];
	let at = index;

	// removing first would shift a later index in the same parent
	if (source === parent && oldIndex < at) at--;
	source.children.splice(oldIndex, 1);
	parent.children.splice(at, 0, moving);

	return true;
}

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Where a drop at (x, y) lands among a container's children, given their boxes
 * in order. Columns split each child at its vertical midpoint. Rows split at the
 * horizontal midpoint, line by line, since a row can wrap: a pointer above a
 * line goes before it, and one inside a line picks a gap within it.
 */
export function insertionIndex(boxes: Box[], x: number, y: number, horizontal: boolean): number {
	for (let i = 0; i < boxes.length; i++) {
		const b = boxes[i];

		if (!horizontal) {
			if (y < (b.top + b.bottom) / 2) return i;
			continue;
		}

		// children of a row align to the top, so one line shares a top edge; the
		// line reaches as low as its tallest child
		let lineBottom = b.bottom;

		for (const o of boxes) {
			if (Math.abs(o.top - b.top) < 1) lineBottom = Math.max(lineBottom, o.bottom);
		}

		if (y < b.top) return i;

		if (y <= lineBottom && x < (b.left + b.right) / 2) return i;
	}

	return boxes.length;
}

/* -------------------------------------------------------------- editor */

type DragPayload = { kind: "new"; type: LayoutNode["type"] } | { kind: "move"; path: number[] };

export class LayoutEditor {
	private dragging: DragPayload | null = null;
	/** The dashboard's root element, so a drag can clear every marker at once. */
	private hostEl: HTMLElement | null = null;
	/** The last layout that parsed, to fall back to if an edit produces one that does not. */
	private lastGood: string;

	constructor(
		private app: App,
		private config: Dashboard,
		private context: FormContext,
		private onChange: (config: Dashboard) => void,
	) {
		this.lastGood = serializeDashboard(config);
	}

	/** Whether a drag is under way, when a redraw would drop it. */
	get isDragging(): boolean {
		return this.dragging !== null;
	}

	/** Marks the element the dashboard is drawn into. */
	attach(host: HTMLElement): void {
		host.addClass("udash-editing");
		this.hostEl = host;
	}

	/* ------------------------------------------------------------ palette */

	renderPalette(el: HTMLElement): void {
		const widgets = el.createDiv({ cls: "udash-palette-group" });

		widgets.createSpan({ cls: "udash-palette-label", text: "Widgets" });

		for (const spec of Object.values(WIDGETS)) this.chip(widgets, spec.type, spec.hint);

		const dividers = el.createDiv({ cls: "udash-palette-group" });

		dividers.createSpan({ cls: "udash-palette-label", text: "Layout" });

		for (const item of DIVIDERS) this.chip(dividers, item.type, item.hint, item.icon);
	}

	private chip(parent: HTMLElement, type: WidgetKind | ContainerKind, hint: string, icon?: string): void {
		const chip = parent.createDiv({ cls: "udash-chip" });

		if (icon) setIcon(chip.createSpan({ cls: "udash-chip-icon" }), icon);
		chip.createSpan({ text: label(type) });
		setTooltip(chip, `${hint}. Drag onto the dashboard.`);
		chip.draggable = true;
		chip.addEventListener("dragstart", (e) => {
			this.dragging = { kind: "new", type };
			e.dataTransfer?.setData("text/plain", type);

			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
			this.setDragging(true);
		});
		chip.addEventListener("dragend", () => this.endDrag());
	}

	/* --------------------------------------------------------- decoration */

	/** Passed to renderNode: adds handles to each node as it is drawn. */
	decorate = (el: HTMLElement, node: LayoutNode, path: number[]): void => {
		if (isContainer(node)) this.decorateContainer(el, node, path);
		else this.decorateWidget(el, node, path);
	};

	private decorateContainer(el: HTMLElement, node: ContainerNode, path: number[]): void {
		const isRoot = path.length === 0;
		const divider = DIVIDERS.find((d) => d.type === node.type);

		el.addClass("udash-edit-container");

		const tab = el.createDiv({ cls: "udash-edit-tab" });

		if (!isRoot) this.grip(tab, el, path);

		if (divider) setIcon(tab.createSpan({ cls: "udash-edit-tab-icon" }), divider.icon);
		tab.createSpan({ cls: "udash-edit-label", text: label(node.type) });
		setTooltip(tab, divider ? divider.hint : "");
		// the root cannot be moved or deleted, but it is still configurable
		this.actions(tab, node, path, isRoot);

		if (node.children.length === 0) {
			el.createDiv({ cls: "udash-edit-empty", text: "Drop widgets here" });
		}

		this.acceptDrops(el, node);
	}

	private decorateWidget(el: HTMLElement, node: LayoutNode, path: number[]): void {
		if (isContainer(node)) return;

		el.addClass("udash-edit-widget");

		const handle = el.createDiv({ cls: "udash-edit-handle" });

		this.grip(handle, el, path);
		handle.createSpan({ cls: "udash-edit-label", text: specFor(node.type).label });
		this.actions(handle, node, path, false);
	}

	/** A grip that drags `el`, showing the whole element under the cursor. */
	private grip(parent: HTMLElement, el: HTMLElement, path: number[]): void {
		const grip = parent.createSpan({ cls: "udash-edit-grip" });

		setIcon(grip, "grip-vertical");
		setTooltip(grip, "Drag to move");
		grip.draggable = true;
		grip.addEventListener("dragstart", (e) => {
			this.dragging = { kind: "move", path };
			e.dataTransfer?.setData("text/plain", path.join("."));

			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				const box = el.getBoundingClientRect();

				e.dataTransfer.setDragImage(el, e.clientX - box.left, e.clientY - box.top);
			}

			e.stopPropagation();
			this.setDragging(true);
			// deferred, or the drag image would be taken already faded
			window.setTimeout(() => el.addClass("is-dragging-self"), 0);
		});
		grip.addEventListener("dragend", () => {
			el.removeClass("is-dragging-self");
			this.endDrag();
		});
	}

	private actions(parent: HTMLElement, node: LayoutNode, path: number[], isRoot: boolean): void {
		const edit = parent.createEl("button", { cls: "udash-icon-button" });

		setIcon(edit, "pencil");
		setTooltip(edit, "Configure");
		edit.addEventListener("click", (e) => {
			e.stopPropagation();
			this.configure(node);
		});

		if (isRoot) return;

		const remove = parent.createEl("button", { cls: "udash-icon-button" });

		setIcon(remove, "trash-2");
		setTooltip(remove, "Remove");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			this.removeAt(path);
			this.commit();
		});
	}

	/* ---------------------------------------------------------------- drag */

	private setDragging(on: boolean): void {
		this.hostEl?.toggleClass("is-dragging", on);
	}

	private endDrag(): void {
		this.dragging = null;
		this.setDragging(false);
		this.clearMarks();

		// Defensive: a re-render mid-drag can leave a detached card marked, and a
		// stale mark means a permanently greyed out widget.
		for (const el of Array.from(this.hostEl?.querySelectorAll(".is-dragging-self") ?? [])) {
			el.removeClass("is-dragging-self");
		}
	}

	private clearMarks(): void {
		for (const el of Array.from(this.hostEl?.querySelectorAll(".is-insert-before, .is-insert-end") ?? [])) {
			el.removeClass("is-insert-before");
			el.removeClass("is-insert-end");
		}
	}

	/**
	 * One drop target per container. The innermost container under the cursor
	 * takes the drop, and the insertion point comes from where the cursor sits
	 * among its children, so there is nothing thin to aim for.
	 */
	private acceptDrops(el: HTMLElement, node: ContainerNode): void {
		const indexAt = (e: DragEvent): number =>
			insertionIndex(
				childrenOf(el).map((c) => c.getBoundingClientRect()),
				e.clientX,
				e.clientY,
				node.type === ContainerKind.Row,
			);

		el.addEventListener("dragover", (e) => {
			if (!this.dragging) return;
			e.preventDefault();
			e.stopPropagation();

			if (e.dataTransfer) e.dataTransfer.dropEffect = this.dragging.kind === "new" ? "copy" : "move";

			const index = indexAt(e);
			const children = childrenOf(el);

			// cleared everywhere, since an outer container keeps its mark when the
			// cursor moves into an inner one
			this.clearMarks();

			if (index < children.length) children[index].addClass("is-insert-before");
			else el.addClass("is-insert-end");
		});
		el.addEventListener("dragleave", (e) => {
			// SAFETY: relatedTarget is the element being entered, or null when the
			// cursor leaves the window; contains() accepts both.
			const entering = e.relatedTarget as globalThis.Node | null;

			if (!el.contains(entering)) this.clearMarks();
		});
		el.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.drop(node, indexAt(e));
		});
	}

	/* -------------------------------------------------------------- edits */

	private drop(parent: ContainerNode, index: number): void {
		const payload = this.dragging;

		this.endDrag();

		if (!payload) return;

		if (payload.kind === "move") {
			if (moveNode(this.config.root, payload.path, parent, index)) this.commit();

			return;
		}

		const node = newNode(payload.type);

		parent.children.splice(index, 0, node);

		if (!isContainer(node) && needsSetup(node)) {
			// Cancelling must not leave a half-made widget behind: it would be
			// serialised without its required fields and fail to parse.
			this.configure(node, () => {
				if (needsSetup(node)) {
					const at = parent.children.indexOf(node);

					if (at >= 0) parent.children.splice(at, 1);
				}

				this.commit();
			});

			return;
		}

		this.commit();
	}

	private configure(node: LayoutNode, onDismiss?: () => void): void {
		const modal = new WidgetForm(this.app, node, this.context, () => this.commit());

		if (onDismiss) modal.onDismiss = onDismiss;
		modal.open();
	}

	private removeAt(path: number[]): void {
		const parent = nodeAt(this.config.root, path.slice(0, -1));

		if (!parent || !isContainer(parent) || path.length === 0) return;
		parent.children.splice(path[path.length - 1], 1);
	}

	/**
	 * Saves, but only a layout that can be read back. The editor must never write
	 * a config it cannot itself load: that strands you with an error and no way
	 * back to the dashboard. A refused edit restores the last good layout.
	 */
	private commit(): void {
		const text = serializeDashboard(this.config);

		try {
			parseDashboard(text);
		} catch (err) {
			new Notice(
				`That change would break the layout: ${
					err instanceof ConfigError ? err.message : String(err)
				}`,
				8000,
			);
			this.onChange(parseDashboard(this.lastGood));

			return;
		}

		this.lastGood = text;
		this.onChange(this.config);
	}
}

/** The child node elements of a container, ignoring handles and hints. */
function childrenOf(el: HTMLElement): HTMLElement[] {
	const out: HTMLElement[] = [];

	for (const child of Array.from(el.children)) {
		if (child instanceof HTMLElement && child.hasClass("udash-node")) out.push(child);
	}

	return out;
}
