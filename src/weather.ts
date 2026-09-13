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
export const SPANS: { readonly [M in WeatherMode]: { days: number; hours: number } } = {
	[WeatherMode.Today]: { days: 1, hours: 0 },
	[WeatherMode.ThreeDay]: { days: 4, hours: 0 },
	[WeatherMode.Weekly]: { days: 8, hours: 0 },
	[WeatherMode.Hourly]: { days: 1, hours: 12 },
};

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

function record(v: unknown, where: string): Record<string, unknown> {
	if (typeof v !== "object" || v === null || Array.isArray(v)) {
		throw new WeatherError(`${where} was not an object`);
	}

	return v as Record<string, unknown>;
}

function number(v: unknown, where: string): number {
	if (typeof v !== "number" || !Number.isFinite(v)) throw new WeatherError(`${where} was not a number`);

	return v;
}

function numbers(v: unknown, where: string): number[] {
	if (!Array.isArray(v)) throw new WeatherError(`${where} was not a list`);

	return v.map((n, i) => number(n, `${where}[${i}]`));
}

/** The geocoding response, which is how a place name becomes coordinates. */
export function parsePlaces(raw: unknown): Place[] {
	const doc = record(raw, "the geocoding response");
	const results = doc.results;

	if (results === undefined) return [];

	if (!Array.isArray(results)) throw new WeatherError("`results` was not a list");

	return results.map((entry, i) => {
		const r = record(entry, `result ${i}`);
		const parts = [r.name, r.admin1, r.country].filter((p) => typeof p === "string" && p);

		return {
			name: parts.join(", "),
			latitude: number(r.latitude, `result ${i} latitude`),
			longitude: number(r.longitude, `result ${i} longitude`),
		};
	});
}

/** A list of ISO stamps, which the API sends for every time series. */
function stamps(v: unknown, where: string): string[] {
	if (!Array.isArray(v) || v.some((d) => typeof d !== "string")) {
		throw new WeatherError(`${where} was not a list of times`);
	}

	return v as string[];
}

/** Optional stamps: absent when the widget did not ask for that field. */
function maybeStamps(v: unknown): string[] {
	return Array.isArray(v) && v.every((d) => typeof d === "string") ? (v as string[]) : [];
}

/** Optional numbers, for the same reason. */
function maybeNumbers(v: unknown): number[] {
	return Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : [];
}

function maybeNumber(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** mp/h is what Open-Meteo calls miles per hour. Nobody else does. */
function tidyUnit(unit: string): string {
	return unit === "mp/h" ? "mph" : unit;
}

export function parseForecast(raw: unknown): Forecast {
	const doc = record(raw, "the forecast response");
	const current = record(doc.current, "`current`");
	const daily = record(doc.daily, "`daily`");
	const units = record(doc.current_units, "`current_units`");

	const dates = stamps(daily.time, "`daily.time`");
	const codes = numbers(daily.weather_code, "`daily.weather_code`");
	const highs = numbers(daily.temperature_2m_max, "`daily.temperature_2m_max`");
	const lows = numbers(daily.temperature_2m_min, "`daily.temperature_2m_min`");
	const rain = numbers(daily.precipitation_probability_max, "`daily.precipitation_probability_max`");
	const sunrise = maybeStamps(daily.sunrise);
	const sunset = maybeStamps(daily.sunset);

	const days: DayForecast[] = dates.map((date, i) => ({
		date,
		code: codes[i] ?? 0,
		high: highs[i] ?? 0,
		low: lows[i] ?? 0,
		rain: rain[i] ?? 0,
		sunrise: sunrise[i],
		sunset: sunset[i],
	}));

	const hours: HourForecast[] = [];

	if (doc.hourly !== undefined) {
		const hourly = record(doc.hourly, "`hourly`");
		const times = stamps(hourly.time, "`hourly.time`");
		const temps = numbers(hourly.temperature_2m, "`hourly.temperature_2m`");
		const hourCodes = numbers(hourly.weather_code, "`hourly.weather_code`");
		const hourRain = maybeNumbers(hourly.precipitation_probability);

		for (const [i, time] of times.entries()) {
			hours.push({
				time,
				temperature: temps[i] ?? 0,
				code: hourCodes[i] ?? 0,
				rain: hourRain[i] ?? 0,
			});
		}
	}

	const windUnit = typeof units.wind_speed_10m === "string" ? tidyUnit(units.wind_speed_10m) : undefined;

	return {
		current: {
			temperature: number(current.temperature_2m, "`current.temperature_2m`"),
			feelsLike: number(current.apparent_temperature, "`current.apparent_temperature`"),
			code: number(current.weather_code, "`current.weather_code`"),
			isDay: current.is_day !== 0,
			wind: maybeNumber(current.wind_speed_10m),
			humidity: maybeNumber(current.relative_humidity_2m),
		},
		days,
		hours,
		unit: typeof units.temperature_2m === "string" ? units.temperature_2m : "°",
		windUnit,
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
