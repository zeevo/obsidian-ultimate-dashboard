/* Harness: runs the real renderers against the real vault, under node, with a
   minimal DOM. Verifies the panels actually produce the elements and numbers
   they should rather than merely compiling. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { ConfigError, ContainerNode, isContainer, parseConfig } from "../src/config";
import { DayRecord } from "../src/data";
import { fillMonth, monthWindow, renderHeatmap, renderLine, renderMonth, renderStats } from "../src/render";
import { renderNode } from "../src/layout";
import { parseICS } from "../src/ics";
import { DEFAULT_CONFIG, activeDashboard, defaultSettings, findAccount, makeDashboard, migrate, uniqueName } from "../src/store";

const VAULT = process.argv[2];

if (!VAULT) throw new Error("usage: run <vault path>");

/* ------------------------------------------------------------- tiny DOM */

class El {
	children: El[] = [];
	classes = new Set<string>();
	attrs: Record<string, string> = {};
	style: Record<string, string> & { setProperty(k: string, v: string): void };
	text = "";

	constructor(public tag = "div", cls?: string) {
		if (cls) cls.split(/\s+/).forEach((c) => this.classes.add(c));
		const store: Record<string, string> = {};
		this.style = new Proxy(store, {
			get: (t, k) => (k === "setProperty" ? (a: string, b: string) => (t[a] = b) : t[k as string]),
			set: (t, k, v) => ((t[k as string] = String(v)), true),
		}) as never;
	}
	private make(tag: string, o?: { cls?: string; text?: string }) {
		const e = new El(tag, o?.cls);

		if (o?.text) e.text = o.text;
		this.children.push(e);

		return e;
	}
	createDiv(o?: { cls?: string; text?: string }) { return this.make("div", o); }
	createSpan(o?: { cls?: string; text?: string }) { return this.make("span", o); }
	createEl(tag: string, o?: { cls?: string; text?: string }) { return this.make(tag, o); }
	setText(t: string) { this.text = t; }
	addClass(c: string) { this.classes.add(c); }
	setAttr(k: string, v: string) { this.attrs[k] = v; }
	setAttribute(k: string, v: string) { this.attrs[k] = v; }
	appendChild(e: El) { this.children.push(e);

 return e; }
	empty() { this.children = []; }
	get all(): El[] { return this.children.flatMap((c) => [c, ...c.all]); }
	byClass(c: string) { return this.all.filter((e) => e.classes.has(c)); }
	querySelector(sel: string) { return this.byClass(sel.replace(/^\./, ""))[0] ?? null; }
}

(globalThis as { document?: unknown }).document = {
	createElementNS: (_ns: string, tag: string) => new El(tag),
};

/* ------------------------------------------------------------ vault read */

const days: DayRecord[] = readdirSync(join(VAULT, "Daily"))
	.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
	.map((f) => {
		const txt = readFileSync(join(VAULT, "Daily", f), "utf8");
		const m = /^---\n([\s\S]*?)\n---/.exec(txt);
		const fm = m ? ((load(m[1]) as Record<string, unknown>) ?? {}) : {};

		return { date: f.replace(/\.md$/, ""), props: fm };
	})
	.sort((a, b) => (a.date < b.date ? -1 : 1));

/* ---------------------------------------------------------------- checks */

let failures = 0;

const check = (name: string, cond: boolean, detail = "") => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);

	if (!cond) failures++;
};

console.log(`daily notes loaded: ${days.length}\n`);

console.log("config parsing");

const good = parseConfig(`
folder: Daily
panels:
  - type: stats
    tiles:
      - { label: Weight, property: weight, agg: latest }
  - type: heatmap
    property: lift
`);

check("valid config parses", good.root.children.length === 2 && good.folder === "Daily");

check("minWidth defaults to 520", good.root.minWidth === 520);

const rejects = (src: string, name: string) => {
	try { parseConfig(src); check(name, false, "no error thrown"); }
	catch (e) { check(name, e instanceof ConfigError, (e as Error).message.slice(0, 46)); }
};

rejects("panels: []", "empty panels rejected");

rejects("panels:\n  - type: bogus", "unknown panel type rejected");

rejects("panels:\n  - type: stats\n    tiles: []", "stats without tiles rejected");

rejects("panels:\n  - type: heatmap", "heatmap without property rejected");

rejects("panels:\n  - type: stats\n    tiles:\n      - { label: X, property: y, agg: nope }", "bad agg rejected");

console.log("\nICS parsing");

{
	const ics = [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"SUMMARY:Simple timed",
		"DTSTART:20260315T140000Z",
		"DTEND:20260315T150000Z",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:All day thing",
		"DTSTART;VALUE=DATE:20260316",
		"DTEND;VALUE=DATE:20260317",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Folded summary that continues",
		" on the next line",
		"DTSTART:20260317T090000Z",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Escaped\\, comma\\; semi",
		"LOCATION:Room 1\\, floor 2",
		"DTSTART:20260318T090000Z",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Weekly standup",
		"DTSTART:20260302T090000Z",
		"DTEND:20260302T091500Z",
		"RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260401T000000Z",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Daily capped",
		"DTSTART:20260310T080000Z",
		"RRULE:FREQ=DAILY;COUNT=3",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Monthly bill",
		"DTSTART:20260131T100000Z",
		"RRULE:FREQ=MONTHLY;COUNT=3",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"SUMMARY:Has exclusion",
		"DTSTART:20260305T120000Z",
		"RRULE:FREQ=DAILY;COUNT=3",
		"EXDATE:20260306T120000Z",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

	const from = new Date(2026, 0, 1);
	const to = new Date(2026, 11, 31);
	const evs = parseICS(ics, from, to);
	const find = (t: string) => evs.filter((e) => e.summary.startsWith(t));

	check("parses a timed event", find("Simple timed").length === 1);
	check("all-day flagged", find("All day thing")[0]?.allDay === true);
	check("timed not flagged all-day", find("Simple timed")[0]?.allDay === false);
	check("folded lines rejoin", find("Folded summary")[0]?.summary.endsWith("on the next line"),
		find("Folded summary")[0]?.summary);
	check("escapes decoded", find("Escaped")[0]?.summary === "Escaped, comma; semi", find("Escaped")[0]?.summary);
	check("location decoded", find("Escaped")[0]?.location === "Room 1, floor 2");
	check("missing DTEND gets an hour", (() => {
		const e = find("Folded summary")[0];

		return e && e.end.getTime() - e.start.getTime() === 3600000;
	})());

	const weekly = find("Weekly standup");
	check("weekly recurrence expands", weekly.length === 5, `${weekly.length} occurrences`);
	check("UNTIL is respected", weekly.every((e) => e.start < new Date(2026, 3, 1)));
	check("weekly lands on Mondays", weekly.every((e) => e.start.getDay() === 1));

	check("COUNT caps a daily rule", find("Daily capped").length === 3, `${find("Daily capped").length}`);
	check("monthly skips months too short for the day", (() => {
		const m = find("Monthly bill");

		return m.length === 3 && m.every((e) => e.start.getDate() === 31) &&
			m.map((e) => e.start.getMonth()).join() === "0,2,4";
	})(), find("Monthly bill").map((e) => e.start.toDateString()).join(" | "));

	const excl = find("Has exclusion");
	check("EXDATE removes an occurrence", excl.length === 2, `${excl.length}`);
	check("results are sorted", evs.every((e, i) => i === 0 || evs[i - 1].start <= e.start));

	// a narrow window must not pull in the whole feed
	const narrow = parseICS(ics, new Date(2026, 2, 16), new Date(2026, 2, 17, 23, 59));
	check("window filters events", narrow.every((e) => e.start < new Date(2026, 2, 18)), `${narrow.length} in window`);
	check("empty input is safe", parseICS("", from, to).length === 0);
	check("garbage input is safe", parseICS("not a calendar at all", from, to).length === 0);
}

console.log("\ndashboard store");

{
	const fresh = defaultSettings();
	check("starts with one dashboard", fresh.dashboards.length === 1);
	check("active points at it", activeDashboard(fresh).id === fresh.dashboards[0].id);

	// the v0.1 single-config shape must survive an upgrade
	const upgraded = migrate({ config: "folder: X\npanels: [{ type: heatmap, property: lift }]" });
	check("v0.1 settings migrate", upgraded.dashboards.length === 1);
	check("v0.1 config preserved", upgraded.dashboards[0].config.includes("folder: X"));
	check("v0.1 gets a valid activeId", activeDashboard(upgraded).id === upgraded.dashboards[0].id);

	check("empty data falls back", migrate(null).dashboards.length === 1);
	check("garbage data falls back", migrate({ dashboards: "nope" }).dashboards.length === 1);
	check("entries without a config are dropped",
		migrate({ dashboards: [{ name: "bad" }, { name: "ok", config: "x" }] }).dashboards.length === 1);
	check("a dangling activeId is repaired", (() => {
		const m = migrate({ dashboards: [{ id: "a", name: "A", config: "x" }], activeId: "gone" });

		return m.activeId === "a";
	})());
	check("round trip is stable", (() => {
		const once = migrate(defaultSettings());

		return migrate(JSON.parse(JSON.stringify(once))).dashboards.length === 1;
	})());

	// v0.2 kept a single google account; it must become the first of a list
	const oneAccount = migrate({
		dashboards: [{ id: "a", name: "A", config: "panels: [{type: heatmap, property: lift}]" }],
		activeId: "a",
		google: { clientId: "cid", clientSecret: "sec", port: 42813, account: { refreshToken: "r1", email: "me@x.com" } },
		calendars: [{ id: "c1", name: "Work", type: "google", calendarId: "cal1" }],
	});

	check("single google account migrates to a list", oneAccount.google.accounts.length === 1);
	check("migrated account keeps its refresh token", oneAccount.google.accounts[0].refreshToken === "r1");
	check("migrated account gains an id", !!oneAccount.google.accounts[0].id);
	check("client credentials survive", oneAccount.google.clientId === "cid");
	check("an orphan google calendar adopts the first account",
		oneAccount.calendars[0].accountId === oneAccount.google.accounts[0].id);

	const twoAccounts = migrate({
		dashboards: [{ id: "a", name: "A", config: "panels: [{type: heatmap, property: lift}]" }],
		activeId: "a",
		google: {
			clientId: "cid", clientSecret: "sec", port: 42813,
			accounts: [
				{ id: "g1", email: "one@x.com", refreshToken: "r1" },
				{ id: "g2", email: "two@x.com", refreshToken: "r2" },
			],
		},
		calendars: [
			{ id: "c1", name: "One", type: "google", accountId: "g1", calendarId: "cal1" },
			{ id: "c2", name: "Two", type: "google", accountId: "g2", calendarId: "cal2" },
			{ id: "c3", name: "Holidays", type: "ics", url: "https://example.com/a.ics" },
		],
	});

	check("two accounts survive", twoAccounts.google.accounts.length === 2);
	check("each calendar keeps its own account",
		twoAccounts.calendars[0].accountId === "g1" && twoAccounts.calendars[1].accountId === "g2");
	check("ics and google share one pool", twoAccounts.calendars.length === 3);
	check("ics sources carry no account", twoAccounts.calendars[2].accountId === undefined);
	check("accounts drop entries without a refresh token",
		migrate({ google: { accounts: [{ id: "x" }, { id: "y", refreshToken: "ok" }] } }).google.accounts.length === 1);
	check("findAccount falls back to the first",
		findAccount(twoAccounts.google)?.id === "g1" && findAccount(twoAccounts.google, "g2")?.id === "g2");

	const s2 = defaultSettings();
	s2.dashboards.push(makeDashboard("Health"));
	check("duplicate names are disambiguated", uniqueName(s2, "Health") === "Health 2");
	check("a free name is left alone", uniqueName(s2, "Training") === "Training");
	check("blank names get a fallback", uniqueName(s2, "   ") === "Untitled");
	check("ids are unique", makeDashboard("a").id !== makeDashboard("b").id);
}

console.log("\nshipped default config");

{
	const def = parseConfig(DEFAULT_CONFIG);
	check("default config parses", isContainer(def.root));
	check("default folder is Daily", def.folder === "Daily");
	const host = new El();
	let errs = 0;
	renderNode(host as never, def.root, days, 20, () => errs++);
	check("default config renders without error", errs === 0, `${errs} errors`);
	check("default config draws panels", host.all.filter((e) => e.classes.has("lifedash-panel")).length === 4,
		`${host.all.filter((e) => e.classes.has("lifedash-panel")).length} panels`);
}

console.log("\nlayout tree");

const tree = parseConfig(`
folder: Daily
layout:
  type: column
  gap: 24
  children:
    - type: row
      children:
        - { type: line, property: weight, flex: 2 }
        - { type: heatmap, property: lift }
    - type: grid
      columns: 3
      children:
        - { type: stats, tiles: [{ label: A, property: weight }] }
        - { type: heatmap, property: read, span: 2 }
        - { type: heatmap, property: vitamins }
`);

check("root is a container", isContainer(tree.root) && tree.root.type === "column");

check("root gap parsed", tree.root.gap === 24);

check("two branches", tree.root.children.length === 2);

const row = tree.root.children[0] as ContainerNode;

const grid = tree.root.children[1] as ContainerNode;

check("row nests two panels", isContainer(row) && row.type === "row" && row.children.length === 3 - 1);

check("flex parsed inside a row", (row.children[0] as { flex?: number }).flex === 2);

check("grid columns parsed", grid.columns === 3);

check("span parsed inside a grid", (grid.children[1] as { span?: unknown }).span === 2);

check("stats defaults to full inside a grid", (grid.children[0] as { span?: unknown }).span === "full");

// legacy flat form must keep working
const flat = parseConfig("columns: 2\npanels:\n  - { type: heatmap, property: lift }");

check("flat panels still parse", isContainer(flat.root) && flat.root.type === "grid" && flat.root.columns === 2);

check("flat form wraps panels as children", flat.root.children.length === 1);

rejects("layout:\n  type: line\n  property: weight", "panel as root rejected");

rejects("layout:\n  type: row", "container without children rejected");

rejects("layout:\n  type: row\n  children: []", "empty children rejected");

rejects("layout:\n  type: line\n  property: w\n  children: [{ type: heatmap, property: lift }]", "panel with children rejected");

rejects("layout:\n  type: row\n  children: [{ type: heatmap, property: lift, span: 2 }]", "span inside a row rejected");

rejects("layout:\n  type: grid\n  columns: 2\n  children: [{ type: heatmap, property: lift, flex: 2 }]", "flex inside a grid rejected");

rejects("layout:\n  type: grid\n  children: [{ type: heatmap, property: lift, span: 2 }]", "numeric span in an auto grid rejected");

rejects("layout:\n  type: grid\n  columns: 2\n  children: [{ type: heatmap, property: lift, span: 3 }]", "span wider than grid rejected");

rejects("layout:\n  type: row\n  columns: 2\n  children: [{ type: heatmap, property: lift }]", "columns on a row rejected");

rejects("layout: { type: column, children: [] }\npanels: []", "layout plus panels rejected");

let deep = "{ type: heatmap, property: lift }";

for (let i = 0; i < 10; i++) deep = `{ type: column, children: [${deep}] }`;

rejects(`layout: ${deep}`, "excessive nesting rejected");

console.log("\ncalendar panels");

{
	const cfg = parseConfig(`
layout:
  type: column
  children:
    - { type: upcoming, days: 21, limit: 12 }
    - { type: calendar, month: "2026-02", maxPerDay: 2, weekStart: 1 }
`);

	const [up, month] = cfg.root.children as [Record<string, unknown>, Record<string, unknown>];

	check("upcoming parses", up.type === "upcoming" && up.days === 21 && up.limit === 12);
	check("calendar parses as a month", month.type === "calendar" && month.month === "2026-02");
	check("month options parsed", month.maxPerDay === 2 && month.weekStart === 1);

	rejects('layout:\n  type: column\n  children: [{ type: calendar, month: "nope" }]', "bad month rejected");
	rejects("layout:\n  type: column\n  children: [{ type: calendar, weekStart: 3 }]", "bad weekStart rejected");
	rejects("layout:\n  type: column\n  children: [{ type: calendar, maxPerDay: 0 }]", "bad maxPerDay rejected");

	// the grid must always be six full weeks, starting on the chosen weekday
	const feb = monthWindow({ type: "calendar", month: "2026-02", weekStart: 0 });

	check("month opens on the first", feb.first.getDate() === 1 && feb.first.getMonth() === 1);
	check("grid starts on the week start", feb.from.getDay() === 0, `day ${feb.from.getDay()}`);
	check("grid covers 42 days",
		Math.round((feb.to.getTime() - feb.from.getTime()) / 86400000) === 42);

	const monday = monthWindow({ type: "calendar", month: "2026-02", weekStart: 1 });

	check("weekStart 1 starts on Monday", monday.from.getDay() === 1, `day ${monday.from.getDay()}`);

	const host = new El();
	const shell = renderMonth(host as never, { type: "calendar", month: "2026-02" }, feb.first);

	fillMonth(shell as never, { type: "calendar", month: "2026-02", maxPerDay: 2 }, feb.first, [
		{ summary: "One", start: new Date(2026, 1, 10, 9), end: new Date(2026, 1, 10, 10), allDay: false },
		{ summary: "Two", start: new Date(2026, 1, 10, 11), end: new Date(2026, 1, 10, 12), allDay: false },
		{ summary: "Three", start: new Date(2026, 1, 10, 13), end: new Date(2026, 1, 10, 14), allDay: false },
		{ summary: "Trip", start: new Date(2026, 1, 20), end: new Date(2026, 1, 23), allDay: true },
	], []);

	check("42 cells drawn", host.byClass("lifedash-month-cell").length === 42,
		`${host.byClass("lifedash-month-cell").length}`);
	check("7 weekday headers", host.byClass("lifedash-month-dow").length === 7);
	check("maxPerDay collapses the rest", host.byClass("lifedash-month-more").length === 1);
	check("a multi-day event spans its days", host.all.filter((e) => e.text === "Trip").length === 3,
		`${host.all.filter((e) => e.text === "Trip").length} days`);
	check("cells outside the month are marked",
		host.byClass("lifedash-month-cell").filter((c) => c.classes.has("is-outside")).length > 0);
}

console.log("\nline ranges");

{
	const dotsOf = (panel: Parameters<typeof renderLine>[2]) => {
		const e = new El();
		renderLine(e, days, panel);
		const svg = e.all.find((x) => x.tag === "svg");

		return {
			dots: svg ? svg.children.filter((c) => c.tag === "circle").length : 0,
			path: svg?.children.find((c) => c.tag === "path")?.attrs.d ?? "",
			el: e,
		};
	};

	const full = dotsOf({ type: "line", property: "weight", rolling: 7 });
	check("no range plots every reading", full.dots > 0, `${full.dots} dots`);

	const yr = dotsOf({ type: "line", property: "weight", rolling: 7, year: 2026 });
	check("year narrows the line", yr.dots > 0 && yr.dots < full.dots, `${yr.dots} of ${full.dots}`);

	const win = dotsOf({ type: "line", property: "weight", rolling: 7, from: "2026-01-01", to: "2026-06-30" });
	check("from/to narrows further", win.dots <= yr.dots, `${win.dots}`);
	check("windowed path has no NaN", !/NaN|undefined/.test(win.path), win.path.slice(0, 26));

	// the average at the left edge must use readings from before the window
	const edge = new El();
	renderLine(edge, days, { type: "line", property: "weight", rolling: 30, from: "2026-08-01" });
	const edgePath = edge.all.find((x) => x.tag === "svg")?.children.find((c) => c.tag === "path")?.attrs.d ?? "";
	check("rolling average survives a windowed start", edgePath.startsWith("M") && !/NaN/.test(edgePath));

	const empty = dotsOf({ type: "line", property: "weight", from: "2000-01-01", to: "2000-12-31" });
	check("empty window degrades gracefully", empty.el.byClass("lifedash-empty").length === 1);
}

rejects("layout:\n  type: column\n  children: [{ type: line, property: weight, year: 2026, days: 30 }]", "two ranges on a line rejected");

rejects('layout:\n  type: column\n  children: [{ type: line, property: weight, from: "bad" }]', "bad line date rejected");

check("rolling and days are independent",
	(() => { const l = parseConfig("layout:\n  type: column\n  children: [{ type: line, property: weight, rolling: 7, days: 90 }]")
		.root.children[0] as { rolling?: number; days?: number };

		return l.rolling === 7 && l.days === 90; })());

console.log("\ntree rendering");

{
	const host = new El();
	renderNode(host as never, tree.root, days, 20, (el, m) => (el as unknown as El).setText("ERR " + m));
	const rootEl = host.children[0];
	check("root div created", !!rootEl && rootEl.classes.has("lifedash-column"));
	check("root is flex column", rootEl.style["display"] === "flex" && rootEl.style["flexDirection"] === "column");
	check("root gap applied", rootEl.style["gap"] === "24px");

	const rowEl = rootEl.children[0];
	check("row renders as flex row", rowEl.style["display"] === "flex" && rowEl.style["flexDirection"] === "row");
	check("row inherits gap", rowEl.style["gap"] === "24px");
	check("flex child sized", rowEl.children[0].style["flex"] === "2 1 0");

	const gridEl = rootEl.children[1];
	check("grid renders as grid", gridEl.style["display"] === "grid");
	check("grid uses fixed columns", gridEl.style["gridTemplateColumns"] === "repeat(3, minmax(0, 1fr))");
	check("span child sized", gridEl.children[1].style["gridColumn"] === "span 2");
	check("stats spans full row", gridEl.children[0].style["gridColumn"] === "1 / -1");

	const panels = host.all.filter((e) => e.classes.has("lifedash-panel"));
	check("every leaf rendered a panel", panels.length === 5, `${panels.length}`);
	check("no error nodes", host.all.filter((e) => e.classes.has("lifedash-error")).length === 0);
	check("heatmaps drawn inside the tree", host.byClass("lifedash-box").length > 0);
	check("line chart drawn inside the tree", !!host.all.find((e) => e.tag === "svg"));
}

console.log("\nstats panel");

const stats = new El();

renderStats(stats, days, parseConfig(`
panels:
  - type: stats
    tiles:
      - { label: Weight, property: weight, agg: latest, unit: lb }
      - { label: Average, property: weight, agg: mean, days: 7 }
      - { label: Lifts, property: lift, agg: count, days: 7, target: 3 }
      - { label: Miles, property: miles, agg: sum }
      - { label: Nothing, property: nosuchprop, agg: latest }
`).root.children[0] as never);

const tiles = stats.byClass("lifedash-tile");

check("one card per tile", tiles.length === 5, `${tiles.length}`);

const values = stats.byClass("lifedash-tile-value").map((e) => e.text);

check("missing property renders as dash", values[4] === "—", JSON.stringify(values[4]));

check("latest weight is numeric", /^\d+\.\d$/.test(values[0]), values[0]);

check("count is a whole number", /^\d+$/.test(values[2]), values[2]);

check("target rendered", stats.byClass("lifedash-tile-target").length === 1);

console.log(`         values: ${JSON.stringify(values)}`);

console.log("\nheatmap panel");

const hm = new El();

renderHeatmap(hm, days, { type: "heatmap", property: "lift", title: "Lifting", year: 2026 });

const boxes = hm.byClass("lifedash-box");

const pads = hm.byClass("lifedash-box-pad");

check("365 day cells for 2026 plus lead padding", boxes.length - pads.length === 365, `${boxes.length - pads.length}`);

const filled = boxes.filter((b) => b.style["backgroundColor"]);

check("lift days shaded", filled.length > 0, `${filled.length} shaded`);

check("month labels present", hm.byClass("lifedash-month").length === 12);

const hmMiles = new El();

renderHeatmap(hmMiles, days, { type: "heatmap", property: "miles", intensity: "miles", year: 2026 });

const shades = new Set(hmMiles.byClass("lifedash-box").map((b) => b.style["backgroundColor"]).filter(Boolean));

check("intensity produces varied shading", shades.size > 1, `${shades.size} distinct shades`);

console.log("\nheatmap ranges");

{
	const boxesOf = (panel: Parameters<typeof renderHeatmap>[2]) => {
		const e = new El();
		renderHeatmap(e, days, panel);
		const all = e.byClass("lifedash-box");

		return { total: all.length, pads: e.byClass("lifedash-box-pad").length, el: e };
	};

	const y = boxesOf({ type: "heatmap", property: "lift", year: 2026 });
	check("year gives 365 day cells", y.total - y.pads === 365, `${y.total - y.pads}`);

	const d90 = boxesOf({ type: "heatmap", property: "lift", days: 90 });
	check("days: 90 gives 90 cells", d90.total - d90.pads === 90, `${d90.total - d90.pads}`);

	const m6 = boxesOf({ type: "heatmap", property: "lift", months: 6 });
	const span6 = m6.total - m6.pads;
	check("months: 6 spans about half a year", span6 >= 180 && span6 <= 185, `${span6} days`);

	const exact = boxesOf({ type: "heatmap", property: "lift", from: "2026-03-01", to: "2026-03-31" });
	check("from/to is inclusive", exact.total - exact.pads === 31, `${exact.total - exact.pads}`);
	check("month label present for a one month window", exact.el.byClass("lifedash-month").length === 1);

	// a window starting mid-month should still be labelled
	const mid = boxesOf({ type: "heatmap", property: "lift", from: "2026-03-15", to: "2026-04-10" });
	check("partial first month still labelled", mid.el.byClass("lifedash-month").length === 2,
		`${mid.el.byClass("lifedash-month").length} labels`);

	const cross = boxesOf({ type: "heatmap", property: "lift", from: "2025-11-01", to: "2026-02-28" });
	const labels = cross.el.byClass("lifedash-month").map((e) => e.text);
	check("cross-year labels carry the year", labels.every((l) => /\s\d{2}$/.test(l)), labels.join(" "));

	// values outside the window must not be counted
	const narrow = new El();
	renderHeatmap(narrow, days, { type: "heatmap", property: "lift", from: "2026-01-01", to: "2026-01-02" });
	const shadedNarrow = narrow.byClass("lifedash-box").filter((b) => b.style["backgroundColor"]).length;
	check("out-of-window days excluded", shadedNarrow === 0, `${shadedNarrow} shaded`);

	check("grid columns set from the window", !!exact.el.byClass("lifedash-heatmap-boxes")[0].style["gridTemplateColumns"]);
}

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, year: 2026, months: 6 }]", "two ranges rejected");

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, months: 0 }]", "months 0 rejected");

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, days: -3 }]", "negative days rejected");

rejects('layout:\n  type: column\n  children: [{ type: heatmap, property: lift, from: "nope" }]', "bad date rejected");

rejects('layout:\n  type: column\n  children: [{ type: heatmap, property: lift, from: "2026-06-01", to: "2026-01-01" }]', "reversed window rejected");

console.log("\nline panel");

const line = new El();

renderLine(line, days, { type: "line", property: "weight", rolling: 7, unit: "lb" });

const svg = line.all.find((e) => e.tag === "svg");

check("svg emitted", !!svg);

const circles = svg ? svg.children.filter((c) => c.tag === "circle").length : 0;

const paths = svg ? svg.children.filter((c) => c.tag === "path") : [];

check("a dot per reading", circles > 0, `${circles} dots`);

check("rolling average path drawn", paths.length === 1 && !!paths[0].attrs.d);

check("path has no NaN", !!paths[0] && !/NaN|Infinity|undefined/.test(paths[0].attrs.d), paths[0]?.attrs.d.slice(0, 30));

const sparse = new El();

renderLine(sparse, [days[0]], { type: "line", property: "weight" });

check("single reading degrades gracefully", sparse.byClass("lifedash-empty").length === 1);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);

process.exit(failures === 0 ? 0 : 1);
