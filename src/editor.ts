import { App, Notice, setIcon, setTooltip } from "obsidian";
import { ConfigError, ContainerNode, DashboardConfig, LayoutNode, isContainer, needsSetup, nextId, parseDashboard } from "./layout-tree";
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

/** Removes the node at `path`. The root has no parent, so it stays. */
export function removeNode(root: ContainerNode, path: number[]): void {
	const parent = nodeAt(root, path.slice(0, -1));

	if (!parent || !isContainer(parent) || path.length === 0) return;
	parent.children.splice(path[path.length - 1], 1);
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

/** How long neighbours take to slide aside, and how long the drop point holds still meanwhile. */
const SETTLE_MS = 150;

export class LayoutEditor {
	private dragging: DragPayload | null = null;
	/**
	 * What moves through the dashboard during a drag: the dragged widget or
	 * group itself, or a placeholder for a new one from the palette. Where it
	 * sits when the drag ends is where the drop lands.
	 */
	private dragEl: HTMLElement | null = null;
	/** Whether the drag has moved anything, so a cancel knows to put it back. */
	private shifted = false;
	/** Until when the neighbours are still sliding, and their boxes are not yet final. */
	private settleUntil = 0;
	/** The container node each outlined element was drawn for. */
	private containers = new WeakMap<HTMLElement, ContainerNode>();
	/** The dashboard's root element, marked while a drag is under way. */
	private hostEl: HTMLElement | null = null;
	/** The last layout that parsed, to fall back to if an edit produces one that does not. */
	private lastGood: string;

	constructor(
		private app: App,
		private config: DashboardConfig,
		private context: FormContext,
		private onChange: (config: DashboardConfig) => void,
		/** Redraws without saving, to undo what a cancelled drag moved. */
		private redraw: () => void,
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
			// held detached until the cursor first reaches a container
			this.dragEl = createDiv({ cls: "udash-edit-placeholder", text: label(type) });
			e.dataTransfer?.setData("text/plain", type);

			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
			this.setDragging(true);
		});
		chip.addEventListener("dragend", () => this.cancelDrag());
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
		el.createDiv({ cls: "udash-edit-type", text: specFor(node.type).label });

		const handle = el.createDiv({ cls: "udash-edit-handle" });

		this.grip(handle, el, path);
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
			this.dragEl = el;
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
		// a drop redraws the dashboard, so this only fires on its own when the
		// drag was abandoned
		grip.addEventListener("dragend", () => this.cancelDrag());
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
			removeNode(this.config.root, path);
			this.commit();
		});
	}

	/* ---------------------------------------------------------------- drag */

	private setDragging(on: boolean): void {
		this.hostEl?.toggleClass("is-dragging", on);
	}

	/** Forgets the drag. The placeholder for a new widget goes with it. */
	private endDrag(): void {
		if (this.dragging?.kind === "new") this.dragEl?.remove();
		this.dragEl?.removeClass("is-dragging-self");
		this.dragging = null;
		this.dragEl = null;
		this.shifted = false;
		this.setDragging(false);
	}

	/** A drag that ended without a drop: puts back whatever it moved. */
	private cancelDrag(): void {
		if (!this.dragging) return;

		const moved = this.shifted;

		this.endDrag();

		if (moved) this.redraw();
	}

	/**
	 * One drop target per container, and the innermost under the cursor wins.
	 * As the cursor moves, the dragged element is moved to where it would land,
	 * so the rest of the dashboard makes room for it in place.
	 */
	private acceptDrops(el: HTMLElement, node: ContainerNode): void {
		this.containers.set(el, node);

		// a group cannot go inside itself; the event bubbles on to a container
		// outside it instead
		const within = (moving: HTMLElement) => moving === el || moving.contains(el);

		el.addEventListener("dragover", (e) => {
			const moving = this.dragEl;

			if (!this.dragging || !moving || within(moving)) return;
			e.preventDefault();
			e.stopPropagation();

			if (e.dataTransfer) e.dataTransfer.dropEffect = this.dragging.kind === "new" ? "copy" : "move";

			// mid-slide, the boxes are still animating and would give a wrong answer
			if (performance.now() < this.settleUntil) return;

			const others = childrenOf(el).filter((c) => c !== moving);

			const index = insertionIndex(
				others.map((c) => c.getBoundingClientRect()),
				e.clientX,
				e.clientY,
				node.type === ContainerKind.Row,
			);

			// past the last child means before the tab, which is drawn after them
			const before = others[index] ?? el.querySelector(":scope > .udash-edit-tab");

			if (moving.parentElement === el && moving.nextElementSibling === before) return;
			this.shift(moving, el, before);
		});
		el.addEventListener("drop", (e) => {
			const moving = this.dragEl;

			if (!moving || within(moving)) return;
			e.preventDefault();
			e.stopPropagation();
			this.drop();
		});
	}

	/**
	 * Moves the dragged element to its new spot, then slides its neighbours from
	 * where they were to where they now are, so the reflow reads as motion
	 * rather than a jump.
	 */
	private shift(moving: HTMLElement, into: HTMLElement, before: Element | null): void {
		const neighbours = new Map<HTMLElement, DOMRect>();

		for (const parent of [into, moving.parentElement]) {
			for (const child of Array.from(parent?.children ?? [])) {
				if (child === moving || !(child instanceof HTMLElement)) continue;

				if (child.hasClass("udash-node")) neighbours.set(child, child.getBoundingClientRect());
			}
		}

		into.insertBefore(moving, before);
		this.shifted = true;

		const sliding: HTMLElement[] = [];

		for (const [child, was] of neighbours) {
			const now = child.getBoundingClientRect();
			const dx = was.left - now.left;
			const dy = was.top - now.top;

			if (dx === 0 && dy === 0) continue;
			child.style.transition = "none";
			child.style.transform = `translate(${dx}px, ${dy}px)`;
			sliding.push(child);
		}

		// one reflow with them back where they were, then let them go
		void into.offsetWidth;

		for (const child of sliding) {
			child.style.transition = `transform ${SETTLE_MS}ms ease`;
			child.style.transform = "";
		}

		this.settleUntil = performance.now() + SETTLE_MS;
	}

	/* -------------------------------------------------------------- edits */

	/** Saves the drag at wherever the dragged element has been moved to. */
	private drop(): void {
		const payload = this.dragging;
		const moving = this.dragEl;
		const at = moving ? placement(moving, this.containers) : null;

		this.endDrag();

		if (!payload || !at) return;

		const { parent, index } = at;

		if (payload.kind === "move") {
			const source = nodeAt(this.config.root, payload.path.slice(0, -1));
			const oldIndex = payload.path[payload.path.length - 1];
			// moveNode counts the parent's children from before the move, when the
			// node itself still held a place ahead of the drop point
			const before = source === parent && oldIndex <= index ? index + 1 : index;

			if (moveNode(this.config.root, payload.path, parent, before)) this.commit();
			else this.redraw();

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

	/** Opens the form for the node at `path`, as its pencil would. */
	configureAt(path: number[]): void {
		const node = nodeAt(this.config.root, path);

		if (node) this.configure(node);
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

/**
 * Where an element sits in the layout: the container node it was moved into,
 * and its index among that container's other children.
 */
export function placement(
	moving: HTMLElement,
	containers: WeakMap<HTMLElement, ContainerNode>,
): { parent: ContainerNode; index: number } | null {
	const parentEl = moving.parentElement;
	const parent = parentEl ? containers.get(parentEl) : undefined;

	if (!parentEl || !parent) return null;

	let index = 0;

	for (const child of Array.from(parentEl.children)) {
		if (child === moving) return { parent, index };

		if (child instanceof HTMLElement && child.hasClass("udash-node")) index++;
	}

	return null;
}

/** The child node elements of a container, ignoring handles and hints. */
function childrenOf(el: HTMLElement): HTMLElement[] {
	const out: HTMLElement[] = [];

	for (const child of Array.from(el.children)) {
		if (child instanceof HTMLElement && child.hasClass("udash-node")) out.push(child);
	}

	return out;
}
