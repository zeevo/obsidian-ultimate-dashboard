import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { ClockHost } from "./host";
import { ClockWidget, RenderContext, WidgetSpec } from "./types";

/**
 * The time, as a string. Takes the moment rather than reading the clock, so it
 * can be tested at midnight and noon without waiting for either.
 */
export function clockText(now: Date, widget: ClockWidget): string {
	const hours = now.getHours();
	const pad = (n: number) => String(n).padStart(2, "0");

	const parts = [
		widget.hour24 === true ? pad(hours) : String(hours % 12 === 0 ? 12 : hours % 12),
		pad(now.getMinutes()),
	];

	if (widget.seconds) parts.push(pad(now.getSeconds()));

	const time = parts.join(":");

	return widget.hour24 === true ? time : `${time} ${hours < 12 ? "am" : "pm"}`;
}

/** The shell for a clock. `renderClock` fills it, and keeps filling it. */
export function renderClock(el: HTMLElement, widget: ClockWidget): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-clock" });

	if (widget.title) wrap.createDiv({ cls: "udash-heatmap-head", text: widget.title });

	return wrap.createDiv({ cls: "udash-clock-body" });
}

/**
 * Where each hand points, in degrees clockwise from twelve.
 *
 * The hour hand carries the minutes and the minute hand carries the seconds, so
 * the hands creep the way a real movement does rather than jumping on the hour.
 */
export interface HandAngles {
	hour: number;
	minute: number;
	second: number;
}

export function handAngles(now: Date): HandAngles {
	const seconds = now.getSeconds();
	const minutes = now.getMinutes() + seconds / 60;
	const hours = (now.getHours() % 12) + minutes / 60;

	return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 };
}

/** A hand as a line from the centre of a 100 unit face. */
function hand(angle: number, length: number) {
	const radians = ((angle - 90) * Math.PI) / 180;

	return {
		x2: (50 + Math.cos(radians) * length).toFixed(2),
		y2: (50 + Math.sin(radians) * length).toFixed(2),
	};
}

function drawFace(body: HTMLElement, widget: ClockWidget, now: Date): void {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 100 100");
	svg.addClass("udash-clock-face");

	const add = (tag: string, attrs: Record<string, string>) => {
		const node = document.createElementNS("http://www.w3.org/2000/svg", tag);

		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
		svg.appendChild(node);
	};

	add("circle", { cx: "50", cy: "50", r: "48", class: "udash-clock-rim" });

	// a tick per hour, longer at the quarters so the face reads at a glance
	for (let i = 0; i < 12; i++) {
		const quarter = i % 3 === 0;
		const outer = hand(i * 30, 44);
		const inner = hand(i * 30, quarter ? 36 : 40);

		add("line", {
			x1: inner.x2, y1: inner.y2, x2: outer.x2, y2: outer.y2,
			class: quarter ? "udash-clock-tick is-quarter" : "udash-clock-tick",
		});
	}

	const angles = handAngles(now);

	add("line", { x1: "50", y1: "50", ...hand(angles.hour, 24), class: "udash-clock-hour" });
	add("line", { x1: "50", y1: "50", ...hand(angles.minute, 36), class: "udash-clock-minute" });

	if (widget.seconds) {
		add("line", { x1: "50", y1: "50", ...hand(angles.second, 40), class: "udash-clock-second" });
	}

	add("circle", { cx: "50", cy: "50", r: "2.5", class: "udash-clock-pin" });
	body.appendChild(svg);
}

/** Fills a shell created by `renderClock`. Called again on every tick. */
export function fillClock(body: HTMLElement, widget: ClockWidget, now: Date): void {
	body.empty();

	if (widget.analog) drawFace(body, widget, now);
	else body.createDiv({ cls: "udash-clock-time", text: clockText(now, widget) });

	if (widget.date) {
		body.createDiv({
			cls: "udash-clock-date",
			text: now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
		});
	}
}

/**
 * Keeps a clock ticking. The interval belongs to an owner released on the next
 * redraw: registering it on the view itself would leave one running per redraw,
 * and the view redraws on every metadata change.
 */
function tick(body: HTMLElement, widget: ClockWidget, host: ClockHost): void {
	const draw = () => fillClock(body, widget, new Date());

	draw();
	// no point redrawing every second for a clock that hides them
	host.own().registerInterval(window.setInterval(draw, widget.seconds ? 1000 : 15000));
}

function renderClockWidget(el: HTMLElement, widget: ClockWidget, ctx: RenderContext): void {
	const body = renderClock(el, widget);

	if (ctx.host) tick(body, widget, ctx.host);
}

export const clock: WidgetSpec<ClockWidget> = {
	type: WidgetKind.Clock,
	label: "Clock",
	hint: "The time, ticking",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{ key: "analog", kind: FieldKind.Toggle, label: "Analog face" },
		{ key: "seconds", kind: FieldKind.Toggle, label: "Show seconds" },
		{ key: "date", kind: FieldKind.Toggle, label: "Show the date" },
		{
			key: "hour24",
			kind: FieldKind.Toggle,
			label: "24 hour clock",
			hint: "Digital only. A face is always twelve hour",
		},
	],
	blank: () => ({ type: WidgetKind.Clock }),
	title: (w) => w.title || "Clock",
	summary: (w) => (w.analog ? "analog" : w.hour24 ? "24 hour" : "12 hour"),
	render: renderClockWidget,
};
