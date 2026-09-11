import { App, Notice, setIcon, setTooltip } from "obsidian";
import { ConfigError, ContainerNode, DashboardConfig, Node, Panel, isContainer, parseConfig } from "./config";
import { serializeConfig } from "./serialize";
import { PanelModal, label } from "./panel-modal";

/**
 * The visual editor: a palette you drag from, and a canvas of drop zones that
 * mirrors the layout tree. Every edit mutates the tree and hands it back, so
 * the text editor and this one are two views of the same document.
 */

const PALETTE: { type: Node["type"]; hint: string }[] = [
	{ type: "stats", hint: "Numbers at a glance" },
	{ type: "line", hint: "A value over time" },
	{ type: "heatmap", hint: "A year of activity" },
	{ type: "upcoming", hint: "Agenda list" },
	{ type: "calendar", hint: "Month grid" },
];

const DIVIDERS: { type: "row" | "column"; hint: string }[] = [
	{ type: "row", hint: "Split into columns, side by side" },
	{ type: "column", hint: "Split into rows, stacked" },
];

/** A fresh node of the given type, with only what the parser demands. */
function blank(type: Node["type"]): Node {
	if (type === "stats") return { type: "stats", tiles: [], span: "full" };

	if (type === "line") return { type: "line", property: "" };

	if (type === "heatmap") return { type: "heatmap", property: "" };

	if (type === "upcoming") return { type: "upcoming" };

	if (type === "calendar") return { type: "calendar" };

	if (type === "grid") return { type: "grid", columns: 2, children: [] };

	// SAFETY: the remaining cases are the container kinds, which take children.
	return { type, children: [] } as ContainerNode;
}

/** Where a dragged item is headed: into `parent` at `index`. */
interface Target {
	parent: ContainerNode;
	index: number;
}

type DragPayload = { kind: "new"; type: Node["type"] } | { kind: "move"; path: number[] };

const pathOf = (path: number[]) => path.join(".");

export class VisualEditor {
	private dragging: DragPayload | null = null;
	/** The editor root, so a drag can widen every drop zone at once. */
	private hostEl: HTMLElement | null = null;
	/** The last layout that parsed, to fall back to if an edit produces one that does not. */
	private lastGood: string;

	constructor(
		private app: App,
		private config: DashboardConfig,
		private context: { properties: string[]; calendars: string[] },
		private onChange: (config: DashboardConfig) => void,
	) {
		this.lastGood = serializeConfig(config);
	}

	render(host: HTMLElement): void {
		host.empty();
		host.addClass("udash-editor");
		this.hostEl = host;

		this.renderPalette(host.createDiv({ cls: "udash-palette" }));

		const canvas = host.createDiv({ cls: "udash-canvas" });

		this.renderContainer(canvas, this.config.root, []);
	}

	/* ------------------------------------------------------------ palette */

	private renderPalette(el: HTMLElement): void {
		el.createDiv({ cls: "udash-palette-label", text: "Panels" });

		const panels = el.createDiv({ cls: "udash-palette-row" });

		for (const item of PALETTE) this.chip(panels, item.type, item.hint);

		el.createDiv({ cls: "udash-palette-label", text: "Dividers" });

		const dividers = el.createDiv({ cls: "udash-palette-row" });

		for (const item of DIVIDERS) this.chip(dividers, item.type, item.hint);

		el.createDiv({
			cls: "udash-palette-hint",
			text: "Drag onto the canvas. Drag a panel already there to move it.",
		});
	}

	private chip(parent: HTMLElement, type: Node["type"], hint: string): void {
		const chip = parent.createDiv({ cls: "udash-chip", text: label(type) });

		setTooltip(chip, hint);
		chip.draggable = true;
		chip.addEventListener("dragstart", (e) => {
			this.dragging = { kind: "new", type };
			e.dataTransfer?.setData("text/plain", type);

			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
			this.setDragging(true);
		});
		chip.addEventListener("dragend", () => this.endDrag());
	}

	/* ------------------------------------------------------------- canvas */

	private renderContainer(el: HTMLElement, node: ContainerNode, path: number[]): void {
		const box = el.createDiv({ cls: `udash-node udash-node-${node.type}` });

		if (path.length > 0) this.makeDraggable(box, path);

		const head = box.createDiv({ cls: "udash-node-head" });

		head.createSpan({ cls: "udash-node-kind", text: label(node.type) });

		if (node.type === "grid") {
			head.createSpan({ cls: "udash-node-meta", text: `${node.columns ?? "auto"} columns` });
		}

		if (path.length > 0) this.controls(head, node, path);

		const body = box.createDiv({ cls: "udash-node-body" });

		this.acceptDrops(body, node);

		if (node.children.length === 0) {
			body.createDiv({ cls: "udash-empty-hint", text: "Drop a panel here" });

			return;
		}

		node.children.forEach((child, i) => {
			const childPath = [...path, i];

			if (isContainer(child)) this.renderContainer(body, child, childPath);
			else this.renderLeaf(body, child, childPath);
		});
	}

	private renderLeaf(el: HTMLElement, node: Panel, path: number[]): void {
		const box = el.createDiv({ cls: `udash-node udash-node-leaf udash-node-${node.type}` });

		this.makeDraggable(box, path);

		const head = box.createDiv({ cls: "udash-node-head" });

		head.createSpan({ cls: "udash-node-kind", text: label(node.type) });
		head.createSpan({ cls: "udash-node-meta", text: describe(node) });
		this.controls(head, node, path);
	}

	private makeDraggable(box: HTMLElement, path: number[]): void {
		box.draggable = true;
		box.addEventListener("dragstart", (e) => {
			this.dragging = { kind: "move", path };
			e.dataTransfer?.setData("text/plain", pathOf(path));

			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
			e.stopPropagation();
			this.setDragging(true);
			window.setTimeout(() => box.addClass("is-dragging-self"), 0);
		});
		box.addEventListener("dragend", () => {
			box.removeClass("is-dragging-self");
			this.endDrag();
		});
	}

	private controls(head: HTMLElement, node: Node, path: number[]): void {
		const actions = head.createDiv({ cls: "udash-node-actions" });
		const parent = this.parentOf(path);
		const index = path[path.length - 1];

		// Buttons are the reliable way to reorder: dragging depends on hitting a
		// gap, and inside a Columns divider those gaps are narrow.
		this.moveButton(actions, "chevron-up", "Move up", parent !== null && index > 0, () =>
			this.swap(path, -1),
		);
		this.moveButton(
			actions,
			"chevron-down",
			"Move down",
			parent !== null && index < parent.children.length - 1,
			() => this.swap(path, 1),
		);

		if (!isContainer(node)) {
			const edit = actions.createEl("button", { cls: "udash-icon-button" });

			edit.draggable = false;
			setIcon(edit, "pencil");
			setTooltip(edit, "Configure");
			edit.addEventListener("click", (e) => {
				e.stopPropagation();
				this.configure(node);
			});
		}

		const remove = actions.createEl("button", { cls: "udash-icon-button" });

		remove.draggable = false;
		setIcon(remove, "trash-2");
		setTooltip(remove, "Remove");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			this.removeAt(path);
			this.commit();
		});
	}

	private moveButton(
		actions: HTMLElement,
		icon: string,
		tip: string,
		enabled: boolean,
		run: () => void,
	): void {
		const button = actions.createEl("button", { cls: "udash-icon-button" });

		setIcon(button, icon);
		setTooltip(button, tip);
		button.disabled = !enabled;
		button.draggable = false;
		button.addEventListener("click", (e) => {
			e.stopPropagation();

			if (enabled) run();
		});
	}

	/** Moves a node one place within its parent. */
	private swap(path: number[], delta: number): void {
		const parent = this.parentOf(path);

		if (!parent) return;
		const from = path[path.length - 1];
		const to = from + delta;

		if (to < 0 || to >= parent.children.length) return;
		const [node] = parent.children.splice(from, 1);

		parent.children.splice(to, 0, node);
		this.commit();
	}

	private setDragging(on: boolean): void {
		this.hostEl?.toggleClass("is-dragging", on);
	}

	private endDrag(): void {
		this.dragging = null;
		this.setDragging(false);

		// Defensive: a re-render mid-drag can leave a detached card marked, and a
		// stale mark means a permanently greyed out panel.
		for (const el of Array.from(this.hostEl?.querySelectorAll(".is-dragging-self") ?? [])) {
			el.removeClass("is-dragging-self");
		}
	}

	/**
	 * One drop target per container, rather than a strip between every pair of
	 * children plus the children themselves. The insertion point comes from where
	 * the cursor sits relative to each child's midpoint, which is how sortable
	 * lists normally work: nothing thin to hit, and the card being dragged does
	 * not have to hide from the pointer to stay out of the way.
	 */
	private acceptDrops(body: HTMLElement, node: ContainerNode): void {
		const indexAt = (e: DragEvent): number => {
			const cards = cardsIn(body);
			const horizontal = node.type === "row";
			const pos = horizontal ? e.clientX : e.clientY;

			for (let i = 0; i < cards.length; i++) {
				const r = cards[i].getBoundingClientRect();
				const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;

				if (pos < mid) return i;
			}

			return cards.length;
		};

		const mark = (index: number): void => {
			const cards = cardsIn(body);

			for (const c of cards) c.removeClass("is-insert-before");
			body.removeClass("is-insert-end");

			if (index < cards.length) cards[index].addClass("is-insert-before");
			else body.addClass("is-insert-end");
		};

		const clear = (): void => {
			for (const c of cardsIn(body)) c.removeClass("is-insert-before");
			body.removeClass("is-insert-end");
		};

		body.addEventListener("dragover", (e) => {
			if (!this.dragging) return;
			e.preventDefault();
			e.stopPropagation();

			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			mark(indexAt(e));
		});
		body.addEventListener("dragleave", (e) => {
			// SAFETY: relatedTarget is the element being entered, or null when the
			// cursor leaves the window; contains() accepts both.
			const entering = e.relatedTarget as globalThis.Node | null;

			if (!body.contains(entering)) clear();
		});
		body.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const index = indexAt(e);

			clear();
			this.drop({ parent: node, index });
		});
	}

	/* -------------------------------------------------------------- edits */

	private drop(target: Target): void {
		const payload = this.dragging;

		this.endDrag();

		if (!payload) return;

		if (payload.kind === "new") {
			const node = blank(payload.type);

			target.parent.children.splice(target.index, 0, node);

			if (!isContainer(node) && PanelModal.needsSetup(node)) {
				// Cancelling must not leave a half-made panel behind: it would be
				// serialised without its required fields and fail to parse.
				this.configure(node, () => {
					if (PanelModal.needsSetup(node)) {
						const at = target.parent.children.indexOf(node);

						if (at >= 0) target.parent.children.splice(at, 1);
					}

					this.commit();
				});

				return;
			}

			this.commit();

			return;
		}

		const moving = this.nodeAt(payload.path);

		if (!moving) return;

		// a container cannot be dropped inside itself
		if (isContainer(moving) && contains(moving, target.parent)) return;
		const from = this.parentOf(payload.path);

		if (!from) return;
		const oldIndex = payload.path[payload.path.length - 1];
		let index = target.index;

		// removing first would shift a later index in the same parent
		if (from === target.parent && oldIndex < index) index--;
		from.children.splice(oldIndex, 1);
		target.parent.children.splice(index, 0, moving);
		this.commit();
	}

	private configure(node: Node, onDismiss?: () => void): void {
		const modal = new PanelModal(this.app, node, this.context, () => this.commit());

		if (onDismiss) modal.onDismiss = onDismiss;
		modal.open();
	}

	private removeAt(path: number[]): void {
		const parent = this.parentOf(path);

		if (!parent) return;
		parent.children.splice(path[path.length - 1], 1);
	}

	private nodeAt(path: number[]): Node | null {
		let node: Node = this.config.root;

		for (const i of path) {
			if (!isContainer(node)) return null;
			const next: Node | undefined = node.children[i];

			if (!next) return null;
			node = next;
		}

		return node;
	}

	private parentOf(path: number[]): ContainerNode | null {
		if (path.length === 0) return null;
		const parent = this.nodeAt(path.slice(0, -1));

		return parent && isContainer(parent) ? parent : null;
	}

	/**
	 * Saves, but only a layout that can be read back. The editor must never write
	 * a config it cannot itself load: that strands you with an error and no way
	 * back to the canvas.
	 */
	private commit(): void {
		const text = serializeConfig(this.config);

		try {
			parseConfig(text);
		} catch (err) {
			new Notice(
				`That change would break the layout: ${
					err instanceof ConfigError ? err.message : String(err)
				}`,
				8000,
			);
			this.config = parseConfig(this.lastGood);
			this.rerender();

			return;
		}

		this.lastGood = text;
		this.onChange(this.config);
	}

	private rerender(): void {
		if (this.hostEl) this.render(this.hostEl);
	}
}

/** Whether `haystack` contains `needle` anywhere below it. */
function contains(haystack: ContainerNode, needle: Node): boolean {
	if (haystack === needle) return true;

	for (const child of haystack.children) {
		if (child === needle) return true;

		if (isContainer(child) && contains(child, needle)) return true;
	}

	return false;
}

/** The one-line summary shown on a panel card. */
function describe(node: Panel): string {
	if (node.type === "stats") {
		return `${node.tiles.length} ${node.tiles.length === 1 ? "tile" : "tiles"}`;
	}

	if (node.type === "line" || node.type === "heatmap") {
		return node.property || "not configured";
	}

	if (node.type === "upcoming") return `${node.days ?? 14} days`;

	return node.month ?? "this month";
}

/** The child cards of a container body, ignoring hints and indicators. */
function cardsIn(body: HTMLElement): HTMLElement[] {
	const out: HTMLElement[] = [];

	for (const child of Array.from(body.children)) {
		if (child instanceof HTMLElement && child.hasClass("udash-node")) out.push(child);
	}

	return out;
}
