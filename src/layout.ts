import { ContainerNode, LayoutNode, isContainer } from "./layout-tree";
import { RenderContext, Widget, specFor } from "./widgets";
import { ContainerKind } from "./kinds";

const DEFAULT_GAP = 20;


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

	el.style.display = "flex";
	el.style.flexDirection = node.type === ContainerKind.Row ? "row" : "column";

	if (node.type === ContainerKind.Row) {
		el.style.flexWrap = node.wrap === false ? "nowrap" : "wrap";
		el.style.alignItems = "flex-start";
	}

	return gap;
}

/**
 * Called with every node's element once it is drawn, and the path of child
 * indexes that reaches it from the root. Edit mode uses it to add handles to
 * the real dashboard rather than drawing a separate canvas.
 */
export type NodeDecorator = (el: HTMLElement, node: LayoutNode, path: number[]) => void;

/** Where a failed widget sits, so the view can offer to edit or remove it. */
export interface FailedAt {
	node: Widget;
	path: number[];
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
): void {
	// a widget's own type is left off: its tile already carries that class, and
	// matching both drew every tile twice, one inside the other
	const el = parent.createDiv({ cls: isContainer(node) ? `udash-node udash-${node.type}` : "udash-node udash-widget" });
	applySizing(el, node);

	if (isContainer(node)) {
		const gap = applyContainer(el, node, inheritedGap);

		node.children.forEach((child, i) => {
			renderAt(el, child, ctx, decorate, gap, [...path, i]);
		});
		decorate?.(el, node, path);

		return;
	}

	let decorated = false;

	const fail = (message: string) => {
		el.empty();
		el.addClass("is-failed");
		ctx.error(el, message, { node, path });

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
}
