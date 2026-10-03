import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { TextWidget, WidgetSpec } from "./types";

/**
 * Free text, as written. Line breaks are kept; markdown is not rendered. With
 * no colours set it takes the theme's text on the same tile background as the
 * other widgets, so it reads in light and dark themes alike.
 */
export function renderText(el: HTMLElement, widget: TextWidget): void {
	const box = el.createDiv({ cls: "udash-text", text: widget.text });

	if (widget.color) box.style.color = widget.color;

	if (widget.background) box.style.backgroundColor = widget.background;
}

/** The first line, shortened, so the editor's card says which text this is. */
function firstLine(text: string): string {
	const line = text.split("\n")[0].trim();

	return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export const text: WidgetSpec<TextWidget> = {
	type: WidgetKind.Text,
	label: "Text",
	hint: "Free text",
	fields: [
		{ key: "text", kind: FieldKind.Text, label: "Text", required: true, multiline: true },
		{ key: "color", kind: FieldKind.Colour, label: "Text color", placeholder: "Theme text" },
		{ key: "background", kind: FieldKind.Colour, label: "Background", placeholder: "Theme background" },
	],
	blank: () => ({ type: WidgetKind.Text, text: "" }),
	title: () => "Text",
	summary: (w) => firstLine(w.text) || "not configured",
	render: (el, widget) => renderText(el, widget),
};
