import { ContainerNode, LayoutNode, isContainer } from "./layout-tree";
import { RenderContext, Widget, specFor } from "./widgets";
import { ContainerKind } from "./kinds";

const DEFAULT_GAP = 20;

/** Columns in a mosaic that does not say. */
export const DEFAULT_COLUMNS = 3;


/** Applies a node's own sizing within whatever container encloses it. */
function applySizing(el: HTMLElement, node: LayoutNode): void {
	if (node.flex !== undefined) {
		// grow by the factor, never overflow on shrink
		el.style.flex = `${node.flex} 1 0`;
		el.style.minWidth = "0";
	}
}

function applyContainer(el: HTMLElement, node: ContainerNode, inheritedGap: number): number {
	const gap = node.gap ?? inheritedGap;
	el.style.gap = `${gap}px`;

	if (node.type === ContainerKind.Mosaic) {
		// rows a pixel tall, so each child can claim exactly its own height; the
		// gap below it is claimed with it rather than left to row-gap
		el.style.display = "grid";
		el.style.gridTemplateColumns = `repeat(${node.columns ?? DEFAULT_COLUMNS}, minmax(0, 1fr))`;
		el.style.gridAutoRows = "1px";
		el.style.gridAutoFlow = "row dense";
		el.style.rowGap = "0";

		return gap;
	}

	el.style.display = "flex";
	el.style.flexDirection = node.type === ContainerKind.Row ? "row" : "column";

	if (node.type === ContainerKind.Row) {
		el.style.flexWrap = node.wrap === false ? "nowrap" : "wrap";
		el.style.alignItems = "flex-start";
	}

	return gap;
}

/** What a mosaic packs: its children, and the editor's stand-ins for them. */
const PACKED = ["udash-node", "udash-edit-placeholder", "udash-edit-empty"];

/**
 * Packs a mosaic. Each child spans as many pixel rows as it is tall, plus the
 * gap, and dense flow slides shorter children up into the holes beside taller
 * ones. Heights change after the first draw (calendars and notes load, a
 * window narrows), so every child is watched and re-measured, and so is
 * anything the editor moves in during a drag.
 */
function packMosaic(el: HTMLElement, node: ContainerNode, childEls: HTMLElement[], gap: number, ctx: LayoutContext): void {
	const columns = node.columns ?? DEFAULT_COLUMNS;

	node.children.forEach((child, i) => {
		childEls[i].style.gridColumn = `span ${Math.min(child.span ?? 1, columns)}`;
	});

	// measuring needs a real layout, and something to disconnect the watchers
	// when the dashboard redraws
	if (!ctx.host || globalThis.ResizeObserver === undefined) return;

	const fit = new ResizeObserver((entries) => {
		for (const entry of entries) {
			// SAFETY: only HTMLElements are observed, by `watch` below.
			const child = entry.target as HTMLElement;

			child.style.gridRowEnd = `span ${Math.max(1, child.offsetHeight + gap)}`;
		}
	});

	const watch = (child: Node) => {
		if (child instanceof HTMLElement && PACKED.some((c) => child.hasClass(c))) fit.observe(child);
	};

	const arrivals = new MutationObserver((records) => {
		for (const record of records) record.addedNodes.forEach(watch);
	});

	Array.from(el.children).forEach(watch);
	arrivals.observe(el, { childList: true });
	ctx.host.own().register(() => {
		fit.disconnect();
		arrivals.disconnect();
	});
}

/**
 * Called with every node's element once it is drawn, and the path of child
 * indexes that reaches it from the root. Edit mode uses it to add handles to
 * the real dashboard rather than drawing a separate canvas.
 */
export type NodeDecorator = (el: HTMLElement, node: LayoutNode, path: number[]) => void;

/** The widget that failed, so the view can name its type. */
export interface FailedAt {
	node: Widget;
}

/** What the walker needs: what widgets get, plus a way to show a failure. */
export interface LayoutContext {
	days: RenderContext["days"];
	host?: RenderContext["host"];
	/**
	 * Draws an error into `el`. `at` is set when a widget failed, and names it;
	 * without it the error belongs to the dashboard as a whole.
	 */
	error(el: HTMLElement, message: string, at?: FailedAt): void;
}

/**
 * Walks the layout tree, creating a div per node. Containers set their own
 * display mode; leaves render a widget. Errors are contained to the node that
 * caused them so one bad widget does not blank the dashboard.
 */
export function renderNode(
	parent: HTMLElement,
	node: LayoutNode,
	ctx: LayoutContext,
	decorate?: NodeDecorator,
): void {
	renderAt(parent, node, ctx, decorate, DEFAULT_GAP, []);
}

function renderAt(
	parent: HTMLElement,
	node: LayoutNode,
	ctx: LayoutContext,
	decorate: NodeDecorator | undefined,
	inheritedGap: number,
	path: number[],
): HTMLElement {
	// a widget's own type is left off: its tile already carries that class, and
	// matching both drew every tile twice, one inside the other
	const el = parent.createDiv({ cls: isContainer(node) ? `udash-node udash-${node.type}` : "udash-node udash-widget" });
	applySizing(el, node);

	if (isContainer(node)) {
		const gap = applyContainer(el, node, inheritedGap);

		const childEls = node.children.map((child, i) => renderAt(el, child, ctx, decorate, gap, [...path, i]));

		if (node.type === ContainerKind.Mosaic) packMosaic(el, node, childEls, gap, ctx);
		decorate?.(el, node, path);

		return el;
	}

	let decorated = false;

	const fail = (message: string) => {
		el.empty();
		el.addClass("is-failed");
		ctx.error(el, message, { node });

		// failing after edit mode decorated the widget took its handle with it
		if (decorated) decorate?.(el, node, path);
	};

	try {
		specFor(node.type).render(el, node, { days: ctx.days, host: ctx.host, fail });
	} catch (e) {
		// SAFETY: the catch binding is whatever a widget renderer threw; Error is
		// the only thing they construct, and a non-Error still stringifies here.
		fail(`${node.type} widget failed: ${(e as Error).message}`);
	}

	decorated = true;
	decorate?.(el, node, path);

	return el;
}
