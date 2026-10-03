import { DayRecord, num } from "../data";
import { DAY_MS } from "../dates";
import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { RANGE_FIELDS, resolveWindow, validateRange } from "./range";
import { LineWidget, WidgetSpec } from "./types";

export function renderLine(el: HTMLElement, days: DayRecord[], widget: LineWidget): void {
	const all: { date: string; v: number }[] = [];

	for (const day of days) {
		const v = num(day, widget.property);

		if (v !== null) all.push({ date: day.date, v });
	}

	const { start, end } = resolveWindow(widget, days, "all");
	const points = all.filter((p) => p.date >= start && p.date <= end);

	const wrap = el.createDiv({ cls: "udash-line" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: line.title(widget) });
	head.createSpan({
		cls: "udash-heatmap-count",
		text: `${points.length} ${points.length === 1 ? "reading" : "readings"}`,
	});

	if (points.length < 2) {
		wrap.createDiv({ cls: "udash-empty", text: "Not enough readings to plot yet." });

		return;
	}

	const ms = (iso: string) => new Date(iso + "T00:00:00").getTime();

	// Rolling average over a calendar window, so gaps in logging do not distort
	// it. Averaged over `all`, not `points`, so readings just before the window
	// still inform the leftmost values instead of the line starting cold.
	const smoothed = widget.rolling
		? points.map((p) => {
				const from = ms(p.date) - (widget.rolling! - 1) * DAY_MS;
				const win = all.filter((o) => ms(o.date) >= from && ms(o.date) <= ms(p.date));

				return { date: p.date, v: win.reduce((s, o) => s + o.v, 0) / win.length };
			})
		: points;

	const W = 720, H = 240, ml = 46, mr = 14, mt = 12, mb = 26;
	const x0 = ms(points[0].date);
	const x1 = ms(points[points.length - 1].date);
	const vals = points.map((p) => p.v);
	let lo = Math.min(...vals), hi = Math.max(...vals);
	const pad = (hi - lo) * 0.12 || 1;
	lo -= pad; hi += pad;

	const X = (iso: string) => ml + ((ms(iso) - x0) / (x1 - x0 || 1)) * (W - ml - mr);
	const Y = (v: number) => mt + ((hi - v) / (hi - lo)) * (H - mt - mb);

	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
	svg.setAttribute("width", "100%");
	svg.addClass("udash-svg");

	const add = (tag: string, attrs: Record<string, string>, text?: string) => {
		const node = document.createElementNS("http://www.w3.org/2000/svg", tag);

		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);

		if (text !== undefined) node.textContent = text;
		svg.appendChild(node);

		return node;
	};

	for (let i = 0; i < 4; i++) {
		const v = lo + ((hi - lo) * i) / 3;
		const y = Y(v).toFixed(1);
		add("line", { x1: String(ml), y1: y, x2: String(W - mr), y2: y, class: "udash-grid" });
		add("text", { x: String(ml - 8), y, "text-anchor": "end", "dominant-baseline": "middle", class: "udash-axis" }, v.toFixed(1) + (widget.unit ? ` ${widget.unit}` : ""));
	}

	let seen = "";

	for (const p of points) {
		const key = p.date.slice(0, 7);

		if (key === seen) continue;
		seen = key;
		add("text", { x: X(p.date).toFixed(1), y: String(H - 7), "text-anchor": "middle", class: "udash-axis" }, key);
	}

	for (const p of points) {
		add("circle", { cx: X(p.date).toFixed(1), cy: Y(p.v).toFixed(1), r: "2", class: "udash-dot" });
	}

	const d = smoothed
		.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)} ${Y(p.v).toFixed(1)}`)
		.join(" ");

	add("path", { d, fill: "none", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round", stroke: widget.color ?? "var(--interactive-accent)" });

	wrap.appendChild(svg);
}

export const line: WidgetSpec<LineWidget> = {
	type: WidgetKind.Line,
	label: "Line chart",
	hint: "A value over time",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{ key: "rolling", kind: FieldKind.Number, label: "Rolling average (days)" },
		{ key: "unit", kind: FieldKind.Text, label: "Unit", placeholder: "lb" },
		{ key: "color", kind: FieldKind.Colour, label: "Color", placeholder: "#3b82f6" },
		...RANGE_FIELDS,
	],
	blank: () => ({ type: WidgetKind.Line, property: "" }),
	title: (w) => w.title || w.property || "Line chart",
	summary: (p) => p.property || "not configured",
	validate: validateRange,
	render: (el, widget, ctx) => renderLine(el, ctx.days, widget),
};
