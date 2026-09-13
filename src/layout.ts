import { ContainerNode, LayoutNode, isContainer } from "./layout-tree";
import { CalendarWidget, NoteWidget, UpcomingWidget, WeatherWidget } from "./widgets";
import { ContainerKind, WidgetKind, assertNever } from "./kinds";
import { DayRecord } from "./data";
import { fillCalendar, fillMonth, monthWindow, renderBlank, renderHeatmap, renderLine, renderMonth, renderNote, renderStat, renderUpcoming, renderWeather } from "./render";

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

/** Fetches a forecast and fills the body a weather tile made for it. */
export type WeatherFiller = (body: HTMLElement, widget: WeatherWidget) => void;

/**
 * Widgets whose content arrives from the network draw a shell first and are
 * filled in when it lands. Grouped rather than passed one positional argument
 * at a time, which was three parameters deep and still growing.
 */
export interface Fillers {
	calendar?: CalendarFiller;
	note?: NoteFiller;
	weather?: WeatherFiller;
}

export function renderNode(
	parent: HTMLElement,
	node: LayoutNode,
	days: DayRecord[],
	inheritedGap: number,
	onError: (el: HTMLElement, message: string) => void,
	fillers: Fillers = {},
): void {
	const el = parent.createDiv({ cls: `udash-node udash-${node.type}` });
	applySizing(el, node);

	if (isContainer(node)) {
		const gap = applyContainer(el, node, inheritedGap);

		for (const child of node.children) {
			renderNode(el, child, days, gap, onError, fillers);
		}

		return;
	}

	el.addClass("udash-widget");

	const noCalendars = "No calendars configured. Add one in settings.";

	try {
		// a switch rather than a chain of ifs: the compiler then names any widget
		// type nobody has handled, instead of it quietly rendering as the last one
		switch (node.type) {
			case WidgetKind.Blank:
				renderBlank(el, node);
				break;

			case WidgetKind.Stat:
				renderStat(el, days, node);
				break;

			case WidgetKind.Heatmap:
				renderHeatmap(el, days, node);
				break;

			case WidgetKind.Line:
				renderLine(el, days, node);
				break;

			case WidgetKind.Note: {
				const body = renderNote(el, node);

				// left showing its placeholder when no renderer is available, as in tests
				fillers.note?.(body, node);
				break;
			}

			case WidgetKind.Weather: {
				const body = renderWeather(el, node);

				fillers.weather?.(body, node);
				break;
			}

			case WidgetKind.Upcoming: {
				const shell = renderUpcoming(el, node);

				if (fillers.calendar) fillers.calendar(shell, node);
				else fillCalendar(shell, [], [noCalendars], false);

				break;
			}

			case WidgetKind.Calendar: {
				const { first } = monthWindow(node);
				const shell = renderMonth(el, node, first);

				if (fillers.calendar) fillers.calendar(shell, node);
				else fillMonth(shell, node, first, [], [noCalendars]);

				break;
			}

			default:
				assertNever(node, "renderNode");
		}
	} catch (e) {
		// SAFETY: the catch binding is whatever a widget renderer threw; Error is
		// the only thing they construct, and a non-Error still stringifies here.
		onError(el, `${node.type} widget failed: ${(e as Error).message}`);
	}
}

export { DEFAULT_GAP };
