import { ContainerNode, LayoutNode, isContainer } from "./layout-tree";
import { CalendarWidget, NoteWidget, UpcomingWidget } from "./widgets";
import { ContainerKind } from "./kinds";
import { DayRecord } from "./data";
import { fillCalendar, fillMonth, monthWindow, renderBlank, renderHeatmap, renderLine, renderMonth, renderNote, renderStat, renderUpcoming } from "./render";

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
 * Walks the layout tree, creating a div per node. Containers set their own
 * display mode; leaves render a widget. Errors are contained to the node that
 * caused them so one bad widget does not blank the dashboard.
 */
/** Supplies calendar events; omitted when no feeds are configured. */
export type CalendarFiller = (el: HTMLElement, widget: CalendarWidget | UpcomingWidget) => void;

/** Renders an embedded note into the body a note tile made for it. */
export type NoteFiller = (body: HTMLElement, widget: NoteWidget) => void;

export function renderNode(
	parent: HTMLElement,
	node: LayoutNode,
	days: DayRecord[],
	inheritedGap: number,
	onError: (el: HTMLElement, message: string) => void,
	fillCalendarWidget?: CalendarFiller,
	fillNoteWidget?: NoteFiller,
): void {
	const el = parent.createDiv({ cls: `udash-node udash-${node.type}` });
	applySizing(el, node);

	if (isContainer(node)) {
		const gap = applyContainer(el, node, inheritedGap);

		for (const child of node.children) {
			renderNode(el, child, days, gap, onError, fillCalendarWidget, fillNoteWidget);
		}

		return;
	}

	el.addClass("udash-widget");

	try {
		if (node.type === "blank") renderBlank(el, node);
		else if (node.type === "stat") renderStat(el, days, node);
		else if (node.type === "heatmap") renderHeatmap(el, days, node);
		else if (node.type === "line") renderLine(el, days, node);
		else if (node.type === "note") {
			const body = renderNote(el, node);

			// left showing its placeholder when no renderer is available, as in tests
			if (fillNoteWidget) fillNoteWidget(body, node);
		} else if (node.type === "upcoming") {
			const shell = renderUpcoming(el, node);

			if (fillCalendarWidget) fillCalendarWidget(shell, node);
			else fillCalendar(shell, [], ["No calendars configured. Add one in settings."], false);
		} else {
			const { first } = monthWindow(node);
			const shell = renderMonth(el, node, first);

			if (fillCalendarWidget) fillCalendarWidget(shell, node);
			else fillMonth(shell, node, first, [], ["No calendars configured. Add one in settings."]);
		}
	} catch (e) {
		// SAFETY: the catch binding is whatever a widget renderer threw; Error is
		// the only thing they construct, and a non-Error still stringifies here.
		onError(el, `${node.type} widget failed: ${(e as Error).message}`);
	}
}

export { DEFAULT_GAP };
