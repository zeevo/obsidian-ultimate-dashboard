import { WidgetKind } from "../kinds";
import { FieldKind } from "../schema";
import { WEATHER_UNITS, Weather, WeatherMode, WeatherQuery, WeatherUnit, describeWeather } from "../weather";
import { WEEKDAYS } from "../dates";
import { WeatherHost } from "./host";
import { RenderContext, WeatherWidget, WidgetSpec } from "./types";

/**
 * The shell for a forecast, filled by `fillWeather` once the host's service
 * answers.
 */
export function renderWeather(el: HTMLElement, widget: WeatherWidget): HTMLElement {
	const wrap = el.createDiv({ cls: "udash-weather" });
	const head = wrap.createDiv({ cls: "udash-heatmap-head" });
	head.createSpan({ text: weather.title(widget) });
	head.createSpan({ cls: "udash-weather-where" });

	const body = wrap.createDiv({ cls: "udash-weather-body" });
	body.createDiv({ cls: "udash-empty", text: "Loading\u2026" });

	return wrap;
}

/** A temperature with no decimal point: a headline has no room for the tenths. */
function degrees(value: number, unit: string): string {
	return `${Math.round(value)}${unit}`;
}

/**
 * "2pm" from a naive ISO stamp. Read off the string rather than through `Date`,
 * because these times are local to the place being forecast, not to the reader.
 */
export function hourLabel(iso: string): string {
	const hour = Number(iso.slice(11, 13));

	return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}`;
}

/** "6:39am", from the same kind of stamp. */
export function clockLabel(iso: string): string {
	const hour = Number(iso.slice(11, 13));

	return `${hour % 12 === 0 ? 12 : hour % 12}:${iso.slice(14, 16)}${hour < 12 ? "am" : "pm"}`;
}

/** One column of a forecast strip. */
function strip(parent: HTMLElement, cls: string): HTMLElement {
	return parent.createDiv({ cls: `udash-weather-strip ${cls}` });
}

/**
 * One column. The high and the low are separate elements rather than `78/66`,
 * which reads as a fraction and left people asking what the number meant.
 */
function column(
	parent: HTMLElement,
	label: string,
	code: number,
	high: number,
	rain: number,
	low?: number,
): void {
	const cell = parent.createDiv({ cls: "udash-weather-cell" });

	cell.createDiv({ cls: "udash-weather-when", text: label });
	cell.createDiv({ cls: "udash-weather-glyph", text: describeWeather(code).icon });

	const temps = cell.createDiv({ cls: "udash-weather-range" });
	temps.createSpan({ cls: "udash-weather-high", text: `${Math.round(high)}\u00b0` });

	if (low !== undefined) {
		temps.createSpan({ cls: "udash-weather-low", text: `${Math.round(low)}\u00b0` });
	}

	// a 3% chance is not information; at 20% it starts to be
	if (rain >= 20) cell.createDiv({ cls: "udash-weather-rain", text: `${Math.round(rain)}%` });
}

/** Fills a shell created by `renderWeather`. */
export function fillWeather(wrap: HTMLElement, weather: Weather, widget: WeatherWidget): void {
	// SAFETY: created by renderWeather on this element; the guard below covers
	// the shell having been replaced under us.
	const body = wrap.querySelector(".udash-weather-body") as HTMLElement | null;

	// SAFETY: as above, and every read of it is guarded.
	const where = wrap.querySelector(".udash-weather-where") as HTMLElement | null;

	if (!body) return;

	const { current, days, hours, unit, windUnit } = weather.forecast;

	// what the place name actually resolved to, so a wrong Springfield shows
	if (where) {
		where.setText(weather.place.name);
		where.setAttr("title", weather.place.name);
	}

	body.empty();

	const today = days[0];
	// today is already the headline, so the strips start tomorrow
	const ahead = days.slice(1);

	/*
	 * Where the range and the extras hang. Normally that is under the headline,
	 * but the headline is optional: an hourly tile opens on the current hour, so
	 * a "now" block above it says the same thing twice. With it off they attach
	 * to the body instead of vanishing with it.
	 */
	let details: HTMLElement = body;

	if (widget.current !== false) {
		const now = describeWeather(current.code, current.isDay);
		const top = body.createDiv({ cls: "udash-weather-now" });

		top.createSpan({ cls: "udash-weather-icon", text: now.icon });

		const readout = top.createDiv({ cls: "udash-weather-readout" });
		readout.createDiv({ cls: "udash-weather-temp", text: degrees(current.temperature, unit) });

		const feels = Math.round(current.feelsLike) !== Math.round(current.temperature)
			? `${now.label}, feels ${degrees(current.feelsLike, unit)}`
			: now.label;

		readout.createDiv({ cls: "udash-weather-label", text: feels });
		details = readout;
	}

	// with no strip to carry them, today's own high and low would be nowhere
	if (hours.length === 0 && ahead.length === 0 && today) {
		const range = details.createDiv({ cls: "udash-weather-today" });

		range.createSpan({ cls: "udash-weather-high", text: `H ${Math.round(today.high)}\u00b0` });
		range.createSpan({ cls: "udash-weather-low", text: `L ${Math.round(today.low)}\u00b0` });
	}

	const extras: string[] = [];

	if (current.wind !== undefined) extras.push(`${Math.round(current.wind)} ${windUnit ?? ""} wind`.trim());

	if (current.humidity !== undefined) extras.push(`${Math.round(current.humidity)}% humidity`);

	if (widget.sun && today?.sunrise && today.sunset) {
		extras.push(`\u2191 ${clockLabel(today.sunrise)}`, `\u2193 ${clockLabel(today.sunset)}`);
	}

	if (extras.length > 0) {
		details.createDiv({ cls: "udash-weather-extras", text: extras.join("  \u00b7  ") });
	}

	if (hours.length > 0) {
		const row = strip(body, "udash-weather-hourly");

		for (const hour of hours) {
			column(row, hourLabel(hour.time), hour.code, hour.temperature, hour.rain);
		}
	}

	if (ahead.length === 0) return;

	const row = strip(body, "udash-weather-days");

	for (const day of ahead) {
		const when = new Date(day.date + "T00:00:00");

		// the date as well as the weekday, so which day a column means is checkable
		column(row, `${WEEKDAYS[when.getDay()]} ${when.getDate()}`, day.code, day.high, day.rain, day.low);
	}
}

/** Fetches a forecast in the background and fills the shell when it lands. */
async function loadWeather(shell: HTMLElement, widget: WeatherWidget, host: WeatherHost, ctx: RenderContext): Promise<void> {
	const query: WeatherQuery = {
		place: widget.place,
		unit: widget.units ?? WeatherUnit.Fahrenheit,
		mode: widget.mode ?? WeatherMode.Today,
		wind: widget.wind === true,
		humidity: widget.humidity === true,
		sun: widget.sun === true,
	};

	try {
		const forecast = await host.weather(query);

		// the view may have redrawn while the request was in flight
		if (!shell.isConnected) return;
		fillWeather(shell, forecast, widget);
	} catch (e) {
		if (!shell.isConnected) return;
		shell.empty();
		// SAFETY: the service throws WeatherError and requestUrl rejects with
		// an Error; the fallback covers anything else that reaches here.
		ctx.error(shell, `${widget.place}: ${(e as Error).message || "could not load"}`);
	}
}

function renderWeatherWidget(el: HTMLElement, widget: WeatherWidget, ctx: RenderContext): void {
	const shell = renderWeather(el, widget);

	if (ctx.host) void loadWeather(shell, widget, ctx.host, ctx);
}

export const weather: WidgetSpec<WeatherWidget> = {
	type: WidgetKind.Weather,
	label: "Weather",
	hint: "Current conditions and forecast",
	fields: [
		{ key: "title", kind: FieldKind.Text, label: "Title" },
		{
			key: "place",
			kind: FieldKind.Text,
			label: "Place",
			required: true,
			placeholder: "Denver",
		},
		{
			key: "mode",
			kind: FieldKind.Choice,
			label: "Forecast",
			choices: [
				{ value: WeatherMode.Today, label: "Today" },
				{ value: WeatherMode.ThreeDay, label: "Next 3 days" },
				{ value: WeatherMode.Hourly, label: "Next 12 hours" },
				{ value: WeatherMode.Weekly, label: "Next 7 days" },
			],
		},
		{
			key: "units",
			kind: FieldKind.Choice,
			label: "Units",
			choices: WEATHER_UNITS.map((u) => ({ value: u, label: u === "celsius" ? "Celsius" : "Fahrenheit" })),
		},
		{
			key: "current",
			kind: FieldKind.Toggle,
			label: "Show current conditions",
			hint: "On unless set. The hourly forecast already opens on the current hour",
		},
		{ key: "wind", kind: FieldKind.Toggle, label: "Show wind" },
		{ key: "humidity", kind: FieldKind.Toggle, label: "Show humidity" },
		{ key: "sun", kind: FieldKind.Toggle, label: "Show sunrise and sunset" },
	],
	blank: () => ({ type: WidgetKind.Weather, place: "" }),
	title: (w) => w.title || "Weather",
	summary: (w) => w.place || "not configured",
	render: renderWeatherWidget,
};
