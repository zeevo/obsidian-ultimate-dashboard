import { App, setIcon, setTooltip } from "obsidian";
import { ContainerNode, DashboardConfig, Node, Panel, isContainer } from "./config";
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

	constructor(
		private app: App,
		private config: DashboardConfig,
		private context: { properties: string[]; calendars: string[] },
		private onChange: (config: DashboardConfig) => void,
	) {}

	render(host: HTMLElement): void {
		host.empty();
		host.addClass("udash-editor");

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
		});
		chip.addEventListener("dragend", () => (this.dragging = null));
	}

	/* ------------------------------------------------------------- canvas */

	private renderContainer(el: HTMLElement, node: ContainerNode, path: number[]): void {
		const box = el.createDiv({ cls: `udash-node udash-node-${node.type}` });
		const head = box.createDiv({ cls: "udash-node-head" });

		head.createSpan({ cls: "udash-node-kind", text: label(node.type) });

		if (node.type === "grid") {
			head.createSpan({ cls: "udash-node-meta", text: `${node.columns ?? "auto"} columns` });
		}

		if (path.length > 0) this.controls(head, node, path);

		const body = box.createDiv({ cls: "udash-node-body" });

		this.dropZone(body, { parent: node, index: 0 });

		node.children.forEach((child, i) => {
			const childPath = [...path, i];

			if (isContainer(child)) this.renderContainer(body, child, childPath);
			else this.renderLeaf(body, child, childPath);
			this.dropZone(body, { parent: node, index: i + 1 });
		});

		if (node.children.length === 0) {
			body.createDiv({ cls: "udash-empty-hint", text: "Drop a panel here" });
		}
	}

	private renderLeaf(el: HTMLElement, node: Panel, path: number[]): void {
		const box = el.createDiv({ cls: `udash-node udash-node-leaf udash-node-${node.type}` });

		box.draggable = true;
		box.addEventListener("dragstart", (e) => {
			this.dragging = { kind: "move", path };
			e.dataTransfer?.setData("text/plain", pathOf(path));
			e.stopPropagation();
		});
		box.addEventListener("dragend", () => (this.dragging = null));

		const head = box.createDiv({ cls: "udash-node-head" });

		head.createSpan({ cls: "udash-node-kind", text: label(node.type) });
		head.createSpan({ cls: "udash-node-meta", text: describe(node) });
		this.controls(head, node, path);
	}

	private controls(head: HTMLElement, node: Node, path: number[]): void {
		const actions = head.createDiv({ cls: "udash-node-actions" });

		if (!isContainer(node)) {
			const edit = actions.createEl("button", { cls: "udash-icon-button" });

			setIcon(edit, "pencil");
			setTooltip(edit, "Configure");
			edit.addEventListener("click", (e) => {
				e.stopPropagation();
				this.configure(node);
			});
		}

		const remove = actions.createEl("button", { cls: "udash-icon-button" });

		setIcon(remove, "trash-2");
		setTooltip(remove, "Remove");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			this.removeAt(path);
			this.commit();
		});
	}

	/** A thin strip that accepts a drop between two siblings. */
	private dropZone(el: HTMLElement, target: Target): void {
		const zone = el.createDiv({ cls: "udash-dropzone" });

		zone.addEventListener("dragover", (e) => {
			if (!this.dragging) return;
			e.preventDefault();
			e.stopPropagation();
			zone.addClass("is-over");
		});
		zone.addEventListener("dragleave", () => zone.removeClass("is-over"));
		zone.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			zone.removeClass("is-over");
			this.drop(target);
		});
	}

	/* -------------------------------------------------------------- edits */

	private drop(target: Target): void {
		const payload = this.dragging;

		this.dragging = null;

		if (!payload) return;

		if (payload.kind === "new") {
			const node = blank(payload.type);

			target.parent.children.splice(target.index, 0, node);

			if (!isContainer(node) && PanelModal.needsSetup(node)) {
				this.configure(node);

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

	private configure(node: Node): void {
		new PanelModal(this.app, node, this.context, () => this.commit()).open();
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

	private commit(): void {
		this.onChange(this.config);
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
