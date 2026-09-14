import * as z from "zod/mini";
import { requestUrl } from "obsidian";

/**
 * Weather from Open-Meteo.
 *
 * Chosen because it needs no API key and no account: a widget works the moment
 * you type a place name. Everything here is cached, because the dashboard
 * redraws whenever any note in the vault changes and an uncached widget would
 * hit the network on every keystroke.
 */

export const WeatherUnit = { Fahrenheit: "fahrenheit", Celsius: "celsius" } as const;

export type WeatherUnit = (typeof WeatherUnit)[keyof typeof WeatherUnit];

export const WEATHER_UNITS = Object.values(WeatherUnit);

/**
 * What a widget shows. One mode per widget rather than a pile of independent
 * lengths: a tile answers one question, and two strips stacked in it answered
 * none of them well.
 */
export const WeatherMode = {
	Today: "today",
	ThreeDay: "3day",
	Hourly: "hourly",
	Weekly: "weekly",
} as const;

export type WeatherMode = (typeof WeatherMode)[keyof typeof WeatherMode];

export const WEATHER_MODES = Object.values(WeatherMode);

export function toWeatherMode(v: unknown): WeatherMode | null {
	return WEATHER_MODES.find((m) => m === v) ?? null;
}

export interface Place {
	name: string;
	latitude: number;
	longitude: number;
}

export interface Conditions {
	temperature: number;
	feelsLike: number;
	code: number;
	isDay: boolean;
	/** Only present when the widget asked for it. */
	wind?: number;
	humidity?: number;
}

export interface HourForecast {
	/** Local to the place, as the API returned it. */
	time: string;
	temperature: number;
	code: number;
	rain: number;
}

export interface DayForecast {
	date: string;
	code: number;
	high: number;
	low: number;
	/** Chance of precipitation, as a percentage. */
	rain: number;
	sunrise?: string;
	sunset?: string;
}

export interface Forecast {
	current: Conditions;
	days: DayForecast[];
	/** Empty unless the widget asked for an hourly forecast. */
	hours: HourForecast[];
	/** Whatever the API labelled the temperatures, so nothing is hardcoded. */
	unit: string;
	windUnit?: string;
}

/** Everything that changes the request, and therefore the cache entry. */
export interface WeatherQuery {
	place: string;
	unit: WeatherUnit;
	mode: WeatherMode;
	wind: boolean;
	humidity: boolean;
	sun: boolean;
}

/**
 * How much time each mode covers. The daily strip skips today, which is already
 * the headline, so a three day forecast asks for four. Hourly still asks for
 * one day, because the headline and the sun times are read off it.
 */
export const SPANS = {
	[WeatherMode.Today]: { days: 1, hours: 0 },
	[WeatherMode.ThreeDay]: { days: 4, hours: 0 },
	[WeatherMode.Weekly]: { days: 8, hours: 0 },
	[WeatherMode.Hourly]: { days: 1, hours: 12 },
} satisfies { readonly [M in WeatherMode]: { days: number; hours: number } };

/* ------------------------------------------------------------- conditions */

interface Condition {
	label: string;
	icon: string;
}

/** WMO weather codes, which is what Open-Meteo reports. */
const CONDITIONS: readonly { codes: readonly number[]; label: string; icon: string }[] = [
	{ codes: [0], label: "Clear", icon: "☀️" },
	{ codes: [1], label: "Mainly clear", icon: "🌤️" },
	{ codes: [2], label: "Partly cloudy", icon: "⛅" },
	{ codes: [3], label: "Overcast", icon: "☁️" },
	{ codes: [45, 48], label: "Fog", icon: "🌫️" },
	{ codes: [51, 53, 55], label: "Drizzle", icon: "🌦️" },
	{ codes: [56, 57], label: "Freezing drizzle", icon: "🌧️" },
	{ codes: [61, 63, 65], label: "Rain", icon: "🌧️" },
	{ codes: [66, 67], label: "Freezing rain", icon: "🌧️" },
	{ codes: [71, 73, 75, 77], label: "Snow", icon: "🌨️" },
	{ codes: [80, 81, 82], label: "Showers", icon: "🌦️" },
	{ codes: [85, 86], label: "Snow showers", icon: "🌨️" },
	{ codes: [95], label: "Thunderstorm", icon: "⛈️" },
	{ codes: [96, 99], label: "Thunderstorm with hail", icon: "⛈️" },
];

/** A code as words and a glyph. Unknown codes report the number rather than lying. */
export function describeWeather(code: number, isDay = true): Condition {
	const found = CONDITIONS.find((c) => c.codes.includes(code));

	if (!found) return { label: `Code ${code}`, icon: "❓" };

	// a sun over a clear midnight reads as broken, so swap the glyph after dark
	if (!isDay && code <= 2) return { label: found.label, icon: "🌙" };

	return found;
}

/* ----------------------------------------------------------------- parsing */

export class WeatherError extends Error {}

/**
 * The response shapes, declared rather than hand narrowed.
 *
 * Extra keys are ignored on purpose: Open-Meteo returns plenty we do not use,
 * and a new field appearing upstream should not break a widget. Optional means
 * "only present when the query asked for it", which is how the modes work.
 */
const PlaceRow = z.object({
	name: z.optional(z.string()),
	admin1: z.optional(z.string()),
	country: z.optional(z.string()),
	latitude: z.number(),
	longitude: z.number(),
});

const GeocodeResponse = z.object({
	results: z.optional(z.array(PlaceRow)),
});

const ForecastResponse = z.object({
	current_units: z.object({
		temperature_2m: z.optional(z.string()),
		wind_speed_10m: z.optional(z.string()),
	}),
	current: z.object({
		temperature_2m: z.number(),
		apparent_temperature: z.number(),
		weather_code: z.number(),
		is_day: z.optional(z.number()),
		wind_speed_10m: z.optional(z.number()),
		relative_humidity_2m: z.optional(z.number()),
	}),
	daily: z.object({
		time: z.array(z.string()),
		weather_code: z.array(z.number()),
		temperature_2m_max: z.array(z.number()),
		temperature_2m_min: z.array(z.number()),
		precipitation_probability_max: z.array(z.number()),
		sunrise: z.optional(z.array(z.string())),
		sunset: z.optional(z.array(z.string())),
	}),
	hourly: z.optional(
		z.object({
			time: z.array(z.string()),
			temperature_2m: z.array(z.number()),
			weather_code: z.array(z.number()),
			precipitation_probability: z.optional(z.array(z.number())),
		}),
	),
});

/** Runs a schema, turning a failure into an error a widget can display. */
function decode<S extends z.ZodMiniType>(schema: S, raw: unknown, what: string): z.infer<S> {
	const result = schema.safeParse(raw);

	if (result.success) return result.data;

	// the prettified form names the path, e.g. "daily.temperature_2m_max[3]"
	throw new WeatherError(`${what}: ${z.prettifyError(result.error).replace(/\s+/g, " ").trim()}`);
}

/** mp/h is what Open-Meteo calls miles per hour. Nobody else does. */
function tidyUnit(unit: string): string {
	return unit === "mp/h" ? "mph" : unit;
}

/** The geocoding response, which is how a place name becomes coordinates. */
export function parsePlaces(raw: unknown): Place[] {
	const doc = decode(GeocodeResponse, raw, "the geocoding response");

	return (doc.results ?? []).map((r) => ({
		name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
		latitude: r.latitude,
		longitude: r.longitude,
	}));
}

export function parseForecast(raw: unknown): Forecast {
	const { current, daily, hourly, current_units: units } = decode(
		ForecastResponse,
		raw,
		"the forecast response",
	);

	// the series are parallel arrays; a short one is padded rather than throwing,
	// since a missing tail is better than no forecast at all
	const days: DayForecast[] = daily.time.map((date, i) => ({
		date,
		code: daily.weather_code[i] ?? 0,
		high: daily.temperature_2m_max[i] ?? 0,
		low: daily.temperature_2m_min[i] ?? 0,
		rain: daily.precipitation_probability_max[i] ?? 0,
		sunrise: daily.sunrise?.[i],
		sunset: daily.sunset?.[i],
	}));

	const hours: HourForecast[] = (hourly?.time ?? []).map((time, i) => ({
		time,
		temperature: hourly?.temperature_2m[i] ?? 0,
		code: hourly?.weather_code[i] ?? 0,
		rain: hourly?.precipitation_probability?.[i] ?? 0,
	}));

	return {
		current: {
			temperature: current.temperature_2m,
			feelsLike: current.apparent_temperature,
			code: current.weather_code,
			isDay: current.is_day !== 0,
			wind: current.wind_speed_10m,
			humidity: current.relative_humidity_2m,
		},
		days,
		hours,
		unit: units.temperature_2m ?? "\u00b0",
		windUnit: units.wind_speed_10m === undefined ? undefined : tidyUnit(units.wind_speed_10m),
	};
}

/* ----------------------------------------------------------------- service */

const FORECAST_TTL_MS = 30 * 60 * 1000;

export interface Weather {
	place: Place;
	forecast: Forecast;
}

export class WeatherService {
	/** Coordinates never move, so these are kept for the session. */
	private places = new Map<string, Place>();
	private cache = new Map<string, { at: number; value: Weather }>();
	private inflight = new Map<string, Promise<Weather>>();

	invalidate(): void {
		this.cache.clear();
		this.inflight.clear();
	}

	private async read<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
		const res = await requestUrl({ url, method: "GET" });

		return parse(res.json);
	}

	/** Turns a place name into coordinates, remembering the answer. */
	async locate(name: string): Promise<Place> {
		const key = name.trim().toLowerCase();
		const known = this.places.get(key);

		if (known) return known;

		const url =
			"https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
			encodeURIComponent(name.trim());

		const found = await this.read(url, parsePlaces);

		if (found.length === 0) throw new WeatherError(`no place called "${name}"`);
		this.places.set(key, found[0]);

		return found[0];
	}

	/** The URL for one query. Only the fields a widget asked for are requested. */
	private url(place: Place, query: WeatherQuery): string {
		const span = SPANS[query.mode];
		const current = ["temperature_2m", "apparent_temperature", "weather_code", "is_day"];

		if (query.wind) current.push("wind_speed_10m");

		if (query.humidity) current.push("relative_humidity_2m");

		const daily = [
			"weather_code",
			"temperature_2m_max",
			"temperature_2m_min",
			"precipitation_probability_max",
		];

		if (query.sun) daily.push("sunrise", "sunset");

		let url =
			"https://api.open-meteo.com/v1/forecast" +
			`?latitude=${place.latitude}&longitude=${place.longitude}` +
			`&current=${current.join(",")}&daily=${daily.join(",")}` +
			`&temperature_unit=${query.unit}&timezone=auto&forecast_days=${span.days}`;

		// mph reads better beside Fahrenheit; km/h beside Celsius
		if (query.wind) {
			url += `&wind_speed_unit=${query.unit === WeatherUnit.Fahrenheit ? "mph" : "kmh"}`;
		}

		if (span.hours > 0) {
			url +=
				"&hourly=temperature_2m,weather_code,precipitation_probability" +
				`&forecast_hours=${span.hours}`;
		}

		return url;
	}

	async weather(request: WeatherQuery): Promise<Weather> {
		const query: WeatherQuery = { ...request, place: request.place.trim() };

		// every option changes the response, so every option belongs in the key
		const key = JSON.stringify({ ...query, place: query.place.toLowerCase() });
		const hit = this.cache.get(key);

		if (hit && Date.now() - hit.at < FORECAST_TTL_MS) return hit.value;

		const running = this.inflight.get(key);

		if (running) return running;

		const job = (async () => {
			const place = await this.locate(query.place);
			const value = { place, forecast: await this.read(this.url(place, query), parseForecast) };
			this.cache.set(key, { at: Date.now(), value });
			this.inflight.delete(key);

			return value;
		})().catch((e) => {
			this.inflight.delete(key);
			throw e;
		});

		this.inflight.set(key, job);

		return job;
	}
}
