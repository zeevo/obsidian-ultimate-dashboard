import { WidgetKind } from "../kinds";
import { blank } from "./blank";
import { clock } from "./clock";
import { heatmap } from "./heatmap";
import { line } from "./line";
import { month } from "./month";
import { note } from "./note";
import { stat } from "./stat";
import { WidgetSpec } from "./types";
import { upcoming } from "./upcoming";
import { weather } from "./weather";

/**
 * The widget registry.
 *
 * Every widget type lives in its own module under this folder: its fields, its
 * label, and how it draws and loads. Parsing, serialising, the configuration
 * form, the editor palette and rendering are all derived from these specs, so
 * adding a type is one module and one line here.
 */

export * from "./types";

export { RANGE_KEYS } from "./range";

/** Every widget type, keyed by its discriminant. */
export const WIDGETS: { readonly [K in WidgetKind]: WidgetSpec } = {
	[WidgetKind.Stat]: stat as WidgetSpec,
	[WidgetKind.Line]: line as WidgetSpec,
	[WidgetKind.Heatmap]: heatmap as WidgetSpec,
	[WidgetKind.Upcoming]: upcoming as WidgetSpec,
	[WidgetKind.Calendar]: month as WidgetSpec,
	[WidgetKind.Note]: note as WidgetSpec,
	[WidgetKind.Blank]: blank as WidgetSpec,
	[WidgetKind.Weather]: weather as WidgetSpec,
	[WidgetKind.Clock]: clock as WidgetSpec,
};

export function specFor(type: WidgetKind): WidgetSpec {
	return WIDGETS[type];
}
