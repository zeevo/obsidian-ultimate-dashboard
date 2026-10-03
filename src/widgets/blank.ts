import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { BlankWidget, WidgetSpec } from "./types";

/** Height a placeholder stands at when it does not name its own. */
const DEFAULT_BLANK_HEIGHT = 120;

/**
 * A placeholder that holds space and draws nothing at all. Useful for trying a
 * layout out before deciding what goes in each slot, and for padding a row so
 * its siblings sit where you want them.
 */
export function renderBlank(el: HTMLElement, widget: BlankWidget): void {
	const box = el.createDiv({ cls: "udash-blank" });
	box.style.minHeight = `${widget.height ?? DEFAULT_BLANK_HEIGHT}px`;
}

export const blank: WidgetSpec<BlankWidget> = {
	type: WidgetKind.Blank,
	label: "Blank",
	hint: "A placeholder that holds space",
	fields: [{ key: "height", kind: FieldKind.Number, label: "Height (px)" }],
	blank: () => ({ type: WidgetKind.Blank }),
	title: () => "Blank",
	summary: () => "placeholder",
	render: (el, widget) => renderBlank(el, widget),
};
