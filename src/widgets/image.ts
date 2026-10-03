import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { ImageWidget, RenderContext, WidgetSpec } from "./types";

/**
 * Whether a source is a URL rather than a vault path. Obsidian forbids `:` in
 * file names, so anything with a scheme in front cannot be a vault file.
 */
function isUrl(src: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

/**
 * A picture from the web or the vault. A vault path is resolved the way a link
 * is, so a bare file name finds the file wherever it lives.
 */
export function renderImage(el: HTMLElement, widget: ImageWidget, ctx: RenderContext): void {
	const wrap = el.createDiv({ cls: "udash-image" });
	// undefined: no host to look the file up in, as in tests; null: no such file
	const src = isUrl(widget.src) ? widget.src : ctx.host?.resourcePath(widget.src);

	if (src === undefined) return;

	if (src === null) {
		ctx.error(wrap, `No file called "${widget.src}"`);

		return;
	}

	const img = wrap.createEl("img");

	img.setAttribute("src", src);
	img.setAttribute("alt", widget.src);
	// dragging the picture would start the browser's own image drag, not move the widget
	img.setAttribute("draggable", "false");

	if (widget.height !== undefined) img.style.height = `${widget.height}px`;
	img.addEventListener("error", () => {
		wrap.empty();
		ctx.error(wrap, `Could not load ${widget.src}`);
	});
}

/** The last segment of a path or URL, for the editor's card. */
function basename(src: string): string {
	return src.split(/[/?#]/).filter(Boolean).pop() ?? src;
}

export const image: WidgetSpec<ImageWidget> = {
	type: WidgetKind.Image,
	label: "Image",
	hint: "A picture from a URL or the vault",
	fields: [
		{
			key: "src",
			kind: FieldKind.Text,
			label: "Image",
			hint: "A URL, or a file in the vault",
			required: true,
			placeholder: "https://... or Attachments/photo.png",
		},
		{ key: "height", kind: FieldKind.Number, label: "Height", unit: "px", hint: "Defaults to the image's own proportions" },
	],
	blank: () => ({ type: WidgetKind.Image, src: "" }),
	title: () => "Image",
	summary: (w) => (w.src ? basename(w.src) : "not configured"),
	render: renderImage,
};
