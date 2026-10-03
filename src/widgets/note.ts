import { stripFrontmatter } from "../data";
import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { NoteHost } from "./host";
import { NoteWidget, RenderContext, WidgetSpec } from "./types";

/** Height a note tile scrolls within when it does not name its own. */
const DEFAULT_NOTE_HEIGHT = 320;

/**
 * The shell for an embedded note, returning the body to fill.
 *
 * The markdown itself is rendered through the host: Obsidian's renderer needs
 * the app and a component to own whatever it creates, neither of which belongs
 * in a module that is otherwise pure DOM.
 */
export function renderNote(el: HTMLElement, widget: NoteWidget): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-note" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: note.title(widget) });

	const body = wrap.createDiv({ cls: "udash-note-body" });
	body.style.maxHeight = `${widget.height ?? DEFAULT_NOTE_HEIGHT}px`;
	body.createDiv({ cls: "udash-empty", text: "Loading\u2026" });

	return body;
}

/**
 * Renders the note through Obsidian's own markdown pipeline, so wikilinks,
 * embeds, tasks and other plugins' code blocks all behave as they do in a
 * normal note. The scroll offset is restored afterwards.
 */
async function fillNote(body: HTMLElement, widget: NoteWidget, host: NoteHost, ctx: RenderContext): Promise<void> {
	const owner = host.own();
	const file = await host.readNote(widget.path);

	// the view may have redrawn while the read was in flight
	if (!body.isConnected) return;
	body.empty();

	if (!file) {
		ctx.error(body, `No note called "${widget.path}"`);

		return;
	}

	await host.renderMarkdown(stripFrontmatter(file.text), body, file.path, owner);

	if (!body.isConnected) return;
	body.scrollTop = host.scrolled.get(widget.path) ?? 0;
	owner.registerDomEvent(body, "scroll", () => host.scrolled.set(widget.path, body.scrollTop));
}

function renderNoteWidget(el: HTMLElement, widget: NoteWidget, ctx: RenderContext): void {
	const body = renderNote(el, widget);

	// left showing its placeholder when no host is available, as in tests
	if (ctx.host) void fillNote(body, widget, ctx.host, ctx);
}

/** The last segment of a vault path, without the extension. */
function basename(path: string): string {
	return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

export const note: WidgetSpec<NoteWidget> = {
	type: WidgetKind.Note,
	label: "Note",
	hint: "Another note, embedded",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{
			key: "path",
			kind: FieldKind.Note,
			label: "Note",
			required: true,
			placeholder: "0 All/Health.md",
		},
		{ key: "height", kind: FieldKind.Number, label: "Height (px)", min: 60 },
	],
	blank: () => ({ type: WidgetKind.Note, path: "" }),
	title: (w) => w.title || basename(w.path) || "Note",
	summary: (p) => p.path || "not configured",
	render: renderNoteWidget,
};
