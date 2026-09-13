/* Harness: runs the real renderers against the real vault, under node, with a
   minimal DOM. Verifies the widgets actually produce the elements and numbers
   they should rather than merely compiling. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { ConfigError, ContainerNode, countWidgets, isContainer, needsSetup, parseDashboard } from "../src/layout-tree";
import { DayRecord, shiftDate, stripFrontmatter, today } from "../src/data";
import { currentStreak, fillMonth, monthWindow, renderBlank, renderHeatmap, renderLine, renderMonth, renderNote, renderStat, fillWeather, renderWeather } from "../src/render";
import { renderNode } from "../src/layout";
import { parseICS } from "../src/ics";
import { serializeDashboard } from "../src/serialize";
import { newNode } from "../src/editor";
import { WeatherError, describeWeather, parseForecast, parsePlaces } from "../src/weather";
import { CONTAINER_KINDS, WIDGET_KINDS } from "../src/kinds";
import { specFor } from "../src/widgets";
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

const strip = (o: unknown): unknown =>
	JSON.parse(JSON.stringify(o, (k, v) => (k === "id" ? undefined : v)));

let failures = 0;

const check = (name: string, cond: boolean, detail = "") => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);

	if (!cond) failures++;
};

console.log(`daily notes loaded: ${days.length}\n`);

console.log("config parsing");

const good = parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: stat, label: Weight, property: weight }
    - type: heatmap
      property: lift
`);

check("valid config parses", good.root.children.length === 2 && good.folder === "Daily");

check("gap is read off the root", parseDashboard("layout:\n  type: column\n  gap: 14\n  children: []").root.gap === 14);

const rejects = (src: string, name: string) => {
	try { parseDashboard(src); check(name, false, "no error thrown"); }
	catch (e) { check(name, e instanceof ConfigError, (e as Error).message.slice(0, 46)); }
};

rejects("layout: {}", "a root with no type rejected");

rejects("layout:\n  type: column\n  children: [{ type: bogus }]", "unknown widget type rejected");

check("a stat with no property needs setup", needsSetup({ id: "t", type: "stat", property: "" } as never));

rejects("layout:\n  type: column\n  children: [{ type: heatmap }]", "heatmap without property rejected");

rejects("layout:\n  type: column\n  children: [{ type: stat, property: y, agg: nope }]", "bad agg rejected");

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
	const upgraded = migrate({ config: "folder: X\nlayout: { type: column, children: [] }" });
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
		dashboards: [{ id: "a", name: "A", config: "layout: { type: column, children: [] }" }],
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
		dashboards: [{ id: "a", name: "A", config: "layout: { type: column, children: [] }" }],
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
	const def = parseDashboard(DEFAULT_CONFIG);
	check("default config parses", isContainer(def.root));
	check("default folder is Daily", def.folder === "Daily");
	const host = new El();
	let errs = 0;
	renderNode(host as never, def.root, days, 20, () => errs++);
	check("default config renders without error", errs === 0, `${errs} errors`);
	const drawn = host.all.filter((e) => e.classes.has("udash-widget")).length;

	check("default config draws every widget it declares", drawn === countWidgets(def.root),
		`${drawn} drawn, ${countWidgets(def.root)} declared`);
}

console.log("\nlayout tree");

const tree = parseDashboard(`
folder: Daily
layout:
  type: column
  gap: 24
  children:
    - type: row
      children:
        - { type: line, property: weight, flex: 2 }
        - { type: heatmap, property: lift }
    - type: row
      children:
        - { type: stat, property: weight }
        - { type: heatmap, property: read, flex: 2 }
        - { type: heatmap, property: vitamins }
`);

check("root is a container", isContainer(tree.root) && tree.root.type === "column");

check("root gap parsed", tree.root.gap === 24);

check("two branches", tree.root.children.length === 2);

const row = tree.root.children[0] as ContainerNode;

const inner = tree.root.children[1] as ContainerNode;

check("row nests two widgets", isContainer(row) && row.type === "row" && row.children.length === 3 - 1);

check("flex parsed inside a row", (row.children[0] as { flex?: number }).flex === 2);

check("nested row parsed", inner.type === "row" && inner.children.length === 3);

check("flex parsed on a nested child", (inner.children[1] as { flex?: number }).flex === 2);

check("a stat carries no implicit sizing", (inner.children[0] as { flex?: number }).flex === undefined);

// legacy flat form must keep working



rejects("layout:\n  type: line\n  property: weight", "widget as root rejected");

rejects("layout:\n  type: row", "container with no children key rejected");

check("an empty container is allowed", (() => {
		const c = parseDashboard("layout:\n  type: row\n  children: []");

		return isContainer(c.root) && c.root.children.length === 0;
	})());

rejects("layout:\n  type: line\n  property: w\n  children: [{ type: heatmap, property: lift }]", "widget with children rejected");

rejects("layout:\n  type: row\n  children: [{ type: heatmap, property: lift, span: 2 }]", "span is rejected outright");




rejects("layout:\n  type: row\n  columns: 2\n  children: [{ type: heatmap, property: lift }]", "columns is rejected outright");

rejects("layout:\n  type: column\n  children: []\npanels: []", "the flat form is rejected");

let deep = "{ type: heatmap, property: lift }";

for (let i = 0; i < 10; i++) deep = `{ type: column, children: [${deep}] }`;

rejects(`layout: ${deep}`, "excessive nesting rejected");

console.log("\nserialisation round trip");

{
	const sources = [
		// every leaf type, with the options each one carries
		`folder: Daily
layout:
  type: column
  gap: 22
  children:
    - { type: stat, label: Weight, property: weight, unit: lb }
    - { type: stat, label: Lifts, property: lift, agg: count, back: 7, target: 3 }
    - type: line
      title: Weight
      property: weight
      rolling: 7
      unit: lb
      months: 6
    - type: heatmap
      title: Lifting
      property: lift
      color: "#ef4444"
      streak: true
      months: 6
    - type: upcoming
      ahead: 21
      limit: 12
      calendars: [Holidays, Work]
    - type: calendar
      month: "2026-02"
      weekStart: 1
      maxPerDay: 4
    - type: note
      title: Plan
      path: 0 All/Health.md
      height: 240
    - type: blank
      height: 80
    - type: weather
      title: Outside
      place: Denver
      days: 4
      units: celsius`,
		// nesting, flex sizing and an explicit range
		`folder: Notes
layout:
  type: column
  gap: 10
  children:
    - type: row
      wrap: false
      children:
        - { type: line, property: weight, flex: 2 }
        - { type: heatmap, property: lift, flex: 1 }
    - type: row
      children:
        - { type: heatmap, property: read, flex: 2 }
        - { type: heatmap, property: vitamins, from: "2025-01-01", to: "2025-12-31" }`,
	];

	for (const [i, src] of sources.entries()) {
		const once = parseDashboard(src);
		const text = serializeDashboard(once);
		let twice;

		try {
			twice = parseDashboard(text);
		} catch (e) {
			check(`config ${i + 1} re-parses`, false, (e as Error).message);

			continue;
		}

		check(`config ${i + 1} re-parses`, true);
		check(`config ${i + 1} is stable`, JSON.stringify(strip(once)) === JSON.stringify(strip(twice)),
			JSON.stringify(strip(once)) === JSON.stringify(strip(twice)) ? "" : "tree changed on round trip");
		check(`config ${i + 1} serialises identically twice`, serializeDashboard(twice) === text);
	}

	// values that would break if written unquoted
	const tricky = parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: heatmap, property: lift, title: "12:30 check", color: "#ef4444" }
    - { type: calendar, month: "2026-02" }
`);

	const out = serializeDashboard(tricky);

	check("a colon in a title survives", JSON.stringify(strip(parseDashboard(out))) === JSON.stringify(strip(tricky)),
		out.split("\n").find((l) => l.includes("check")) ?? "");
	check("a month stays a string, not a date",
		(parseDashboard(out).root.children[1] as { month?: string }).month === "2026-02");
	check("a hex colour stays quoted", out.includes('"#ef4444"'));
}

console.log("\nvisual editor edits");

{
	// the editor mutates the tree and writes through the serialiser, so an edit
	// is only correct if the result still parses back to what was intended
	const base = () => parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: heatmap, property: lift }
    - { type: line, property: weight }
`);

	const cfg = base();
	const root = cfg.root;

	// drop a new widget between the two existing ones
	root.children.splice(1, 0, { id: "t", type: "upcoming" });
	const afterInsert = parseDashboard(serializeDashboard(cfg));

	check("an inserted widget survives the round trip",
		afterInsert.root.children.map((c) => c.type).join() === "heatmap,upcoming,line",
		afterInsert.root.children.map((c) => c.type).join());

	// move the last child to the front, as a drag would
	const moved = base();
	const [last] = moved.root.children.splice(1, 1);

	moved.root.children.splice(0, 0, last);
	check("a moved widget survives",
		parseDashboard(serializeDashboard(moved)).root.children.map((c) => c.type).join() === "line,heatmap");

	// wrap two widgets in a row divider
	const nested = base();
	const taken = nested.root.children.splice(0, 2);

	nested.root.children.push({ type: "row", children: taken });
	const afterWrap = parseDashboard(serializeDashboard(nested));
	const wrapped = afterWrap.root.children[0];

	check("a divider can wrap existing widgets",
		isContainer(wrapped) && wrapped.type === "row" && wrapped.children.length === 2);

	// a freshly dropped widget is incomplete until configured
	const bare = base();

	bare.root.children.push({ id: "t", type: "heatmap", property: "" });
	let rejected = false;

	try { parseDashboard(serializeDashboard(bare)); } catch { rejected = true; }

	check("an unconfigured widget is caught by the parser", rejected);

	// dropping a divider makes an empty container, which must survive a save
	const withDivider = base();

	withDivider.root.children.push({ id: "t", type: "row", children: [] });
	const dividerText = serializeDashboard(withDivider);

	check("an empty divider serialises as an explicit list", dividerText.includes("children: []"),
		dividerText.split("\n").filter((l) => l.includes("children")).join(" | "));

	let dividerOk = true;
	let dividerMsg = "";

	try { parseDashboard(dividerText); } catch (e) { dividerOk = false; dividerMsg = (e as Error).message; }

	check("an empty divider re-parses", dividerOk, dividerMsg);

	// and nested empties too, since dividers can hold dividers
	const deepEmpty = base();

	deepEmpty.root.children.push({ id: "t", type: "row", children: [{ type: "column", children: [] }] });
	let deepOk = true;

	try { parseDashboard(serializeDashboard(deepEmpty)); } catch { deepOk = false; }

	check("a nested empty divider re-parses", deepOk);

	// moving an existing widget into a divider, which is the whole point of one
	const intoDivider = base();

	intoDivider.root.children.push({ id: "t", type: "row", children: [] });
	const [taken2] = intoDivider.root.children.splice(0, 1);
	const divider = intoDivider.root.children[intoDivider.root.children.length - 1];

	if (isContainer(divider)) divider.children.push(taken2);

	const moved2 = parseDashboard(serializeDashboard(intoDivider));
	const target = moved2.root.children.find((c) => isContainer(c));

	check("a widget can move into a divider",
		!!target && isContainer(target) && target.children.length === 1 &&
			target.children[0].type === "heatmap",
		target && isContainer(target) ? target.children.map((c) => c.type).join() : "no divider");
	check("the widget left its old parent", moved2.root.children.length === 2,
		`${moved2.root.children.length} top level children`);

	// reordering within a parent, which is what the up/down buttons do
	const ordered = parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: heatmap, property: a }
    - { type: heatmap, property: b }
    - { type: heatmap, property: c }
`);

	const kids = ordered.root.children;

	const names = () =>
		parseDashboard(serializeDashboard(ordered)).root.children.map(
			(c) => (c as { property?: string }).property,
		).join();

	// move the middle one up
	const [middle] = kids.splice(1, 1);

	kids.splice(0, 0, middle);
	check("moving up reorders", names() === "b,a,c", names());

	// and back down
	const [first] = kids.splice(0, 1);

	kids.splice(1, 0, first);
	check("moving down reorders", names() === "a,b,c", names());

	// the ends must not wrap around
	check("the first has nothing above it", kids.indexOf(kids[0]) === 0);
	check("the last has nothing below it", kids.indexOf(kids[2]) === kids.length - 1);

	// the insertion index is computed from cursor position against child
	// midpoints, and dropping a node back where it started must be a no-op
	const idx = (positions: number[], cursor: number) => {
		for (let i = 0; i < positions.length; i++) {
			if (cursor < positions[i]) return i;
		}

		return positions.length;
	};

	const mids = [50, 150, 250];

	check("above the first midpoint inserts at 0", idx(mids, 10) === 0);
	check("between two midpoints inserts between", idx(mids, 100) === 1, String(idx(mids, 100)));
	check("past the last midpoint appends", idx(mids, 999) === 3, String(idx(mids, 999)));

	// dropping onto its own position leaves the order alone
	const stable = parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: heatmap, property: a }
    - { type: heatmap, property: b }
`);

	const order = () =>
		stable.root.children.map((c) => (c as { property?: string }).property).join();

	const applyMove = (from: number, to: number) => {
		let target = to;

		if (from < target) target--;
		const [n] = stable.root.children.splice(from, 1);

		stable.root.children.splice(target, 0, n);
	};

	applyMove(0, 0);
	check("dropping in place changes nothing", order() === "a,b", order());
	applyMove(0, 2);
	check("dropping past the end moves to last", order() === "b,a", order());

	// the editor must never save a layout it cannot read back
	const guarded = parseDashboard(`
folder: Daily
layout:
  type: column
  children:
    - { type: heatmap, property: lift }
`);

	const good = serializeDashboard(guarded);

	// a widget dropped but never configured
	guarded.root.children.push({ id: "t", type: "heatmap", property: "" });
	let broke = false;

	try { parseDashboard(serializeDashboard(guarded)); } catch { broke = true; }

	check("an unconfigured widget would break the layout", broke);

	// dropping it, as the guard does, restores a readable layout
	guarded.root.children.pop();
	let recovered = true;

	try { parseDashboard(serializeDashboard(guarded)); } catch { recovered = false; }

	check("removing it recovers", recovered);
	check("and matches the last good layout", serializeDashboard(guarded) === good);

	// retyping a container must not leave options the new kind rejects
	const retyped = parseDashboard(`
folder: Daily
layout:
  type: row
  wrap: false
  children:
    - { type: heatmap, property: lift }
`);

	retyped.root.type = "column";
	delete retyped.root.wrap;

	let retypeOk = true;
	let retypeErr = "";

	try { parseDashboard(serializeDashboard(retyped)); } catch (e) { retypeOk = false; retypeErr = (e as Error).message; }

	check("a row can become a column", retypeOk, retypeErr);

	const stale = parseDashboard(`
folder: Daily
layout:
  type: row
  wrap: false
  children:
    - { type: heatmap, property: lift }
`);

	stale.root.type = "column";

	// the serialiser only writes `wrap` for a row, so retyping cannot produce an
	// invalid document even when the caller forgets to clear it
	const staleText = serializeDashboard(stale);

	check("retyping drops the option the new kind rejects", !staleText.includes("wrap"),
		staleText.split("\n").slice(1, 4).join(" | "));

	// the shipped default starts as a plain stack now
	const fresh = parseDashboard(DEFAULT_CONFIG);

	check("a new dashboard starts as a column", fresh.root.type === "column", fresh.root.type);

	// removing a widget
	const pruned = base();

	pruned.root.children.splice(0, 1);
	check("a removed widget is gone",
		parseDashboard(serializeDashboard(pruned)).root.children.length === 1);
}

console.log("\ncalendar widgets");

{
	const cfg = parseDashboard(`
layout:
  type: column
  children:
    - { type: upcoming, ahead: 21, limit: 12 }
    - { type: calendar, month: "2026-02", maxPerDay: 2, weekStart: "1" }
`);

	const [up, month] = cfg.root.children as [Record<string, unknown>, Record<string, unknown>];

	check("upcoming parses", up.type === "upcoming" && up.ahead === 21 && up.limit === 12);
	check("calendar parses as a month", month.type === "calendar" && month.month === "2026-02");
	check("month options parsed", month.maxPerDay === 2 && month.weekStart === "1");

	rejects('layout:\n  type: column\n  children: [{ type: calendar, month: "nope" }]', "bad month rejected");
	rejects("layout:\n  type: column\n  children: [{ type: calendar, weekStart: \"3\" }]", "bad weekStart rejected");
	rejects("layout:\n  type: column\n  children: [{ type: calendar, maxPerDay: 0 }]", "bad maxPerDay rejected");

	// the grid must always be six full weeks, starting on the chosen weekday
	const feb = monthWindow({ id: "t", type: "calendar", month: "2026-02", weekStart: 0 });

	check("month opens on the first", feb.first.getDate() === 1 && feb.first.getMonth() === 1);
	check("grid starts on the week start", feb.from.getDay() === 0, `day ${feb.from.getDay()}`);
	check("grid covers 42 days",
		Math.round((feb.to.getTime() - feb.from.getTime()) / 86400000) === 42);

	const monday = monthWindow({ id: "t", type: "calendar", month: "2026-02", weekStart: 1 });

	check("weekStart 1 starts on Monday", monday.from.getDay() === 1, `day ${monday.from.getDay()}`);

	const host = new El();
	const shell = renderMonth(host as never, { id: "t", type: "calendar", month: "2026-02" }, feb.first);

	fillMonth(shell as never, { id: "t", type: "calendar", month: "2026-02", maxPerDay: 2 }, feb.first, [
		{ summary: "One", start: new Date(2026, 1, 10, 9), end: new Date(2026, 1, 10, 10), allDay: false },
		{ summary: "Two", start: new Date(2026, 1, 10, 11), end: new Date(2026, 1, 10, 12), allDay: false },
		{ summary: "Three", start: new Date(2026, 1, 10, 13), end: new Date(2026, 1, 10, 14), allDay: false },
		{ summary: "Trip", start: new Date(2026, 1, 20), end: new Date(2026, 1, 23), allDay: true },
	], []);

	check("42 cells drawn", host.byClass("udash-month-cell").length === 42,
		`${host.byClass("udash-month-cell").length}`);
	check("7 weekday headers", host.byClass("udash-month-dow").length === 7);
	check("maxPerDay collapses the rest", host.byClass("udash-month-more").length === 1);
	check("a multi-day event spans its days", host.all.filter((e) => e.text === "Trip").length === 3,
		`${host.all.filter((e) => e.text === "Trip").length} days`);
	check("cells outside the month are marked",
		host.byClass("udash-month-cell").filter((c) => c.classes.has("is-outside")).length > 0);
}

console.log("\nline ranges");

{
	const dotsOf = (widget: Parameters<typeof renderLine>[2]) => {
		const e = new El();
		renderLine(e, days, widget);
		const svg = e.all.find((x) => x.tag === "svg");

		return {
			dots: svg ? svg.children.filter((c) => c.tag === "circle").length : 0,
			path: svg?.children.find((c) => c.tag === "path")?.attrs.d ?? "",
			el: e,
		};
	};

	const full = dotsOf({ id: "t", type: "line", property: "weight", rolling: 7 });
	check("no range plots every reading", full.dots > 0, `${full.dots} dots`);

	const yr = dotsOf({ id: "t", type: "line", property: "weight", rolling: 7, year: 2026 });
	check("year narrows the line", yr.dots > 0 && yr.dots < full.dots, `${yr.dots} of ${full.dots}`);

	const win = dotsOf({ id: "t", type: "line", property: "weight", rolling: 7, from: "2026-01-01", to: "2026-06-30" });
	check("from/to narrows further", win.dots <= yr.dots, `${win.dots}`);
	check("windowed path has no NaN", !/NaN|undefined/.test(win.path), win.path.slice(0, 26));

	// the average at the left edge must use readings from before the window
	const edge = new El();
	renderLine(edge, days, { id: "t", type: "line", property: "weight", rolling: 30, from: "2026-08-01" });
	const edgePath = edge.all.find((x) => x.tag === "svg")?.children.find((c) => c.tag === "path")?.attrs.d ?? "";
	check("rolling average survives a windowed start", edgePath.startsWith("M") && !/NaN/.test(edgePath));

	const empty = dotsOf({ id: "t", type: "line", property: "weight", from: "2000-01-01", to: "2000-12-31" });
	check("empty window degrades gracefully", empty.el.byClass("udash-empty").length === 1);
}

rejects("layout:\n  type: column\n  children: [{ type: line, property: weight, year: 2026, days: 30 }]", "two ranges on a line rejected");

rejects('layout:\n  type: column\n  children: [{ type: line, property: weight, from: "bad" }]', "bad line date rejected");

check("rolling and back are independent",
	(() => { const l = parseDashboard("layout:\n  type: column\n  children: [{ type: line, property: weight, rolling: 7, back: 90 }]")
		.root.children[0] as { rolling?: number; back?: number };

		return l.rolling === 7 && l.back === 90; })());

console.log("\ntree rendering");

{
	const host = new El();
	renderNode(host as never, tree.root, days, 20, (el, m) => (el as unknown as El).setText("ERR " + m));
	const rootEl = host.children[0];
	check("root div created", !!rootEl && rootEl.classes.has("udash-column"));
	check("root is flex column", rootEl.style["display"] === "flex" && rootEl.style["flexDirection"] === "column");
	check("root gap applied", rootEl.style["gap"] === "24px");

	const rowEl = rootEl.children[0];
	check("row renders as flex row", rowEl.style["display"] === "flex" && rowEl.style["flexDirection"] === "row");
	check("row inherits gap", rowEl.style["gap"] === "24px");
	check("flex child sized", rowEl.children[0].style["flex"] === "2 1 0");

	const nestedEl = rootEl.children[1];

	check("a nested row renders as a flex row",
		nestedEl.style["display"] === "flex" && nestedEl.style["flexDirection"] === "row");
	check("flex child inside it is sized", nestedEl.children[1].style["flex"] === "2 1 0");
	check("an unsized child gets no inline flex", !nestedEl.children[0].style["flex"]);

	const widgets = host.all.filter((e) => e.classes.has("udash-widget"));
	check("every leaf rendered a widget", widgets.length === 5, `${widgets.length}`);
	check("no error nodes", host.all.filter((e) => e.classes.has("udash-error")).length === 0);
	check("heatmaps drawn inside the tree", host.byClass("udash-box").length > 0);
	check("line chart drawn inside the tree", !!host.all.find((e) => e.tag === "svg"));
}

console.log("\nstats widget");

const stats = new El();

/** The old stats widget is now a row of stat widgets, so render them as one. */
const renderStatRow = (host: El, d: typeof days, widgets: never) => {
	for (const p of widgets as unknown as Parameters<typeof renderStat>[2][]) {
		renderStat(host as never, d, p);
	}
};

renderStatRow(stats, days, parseDashboard(`
layout:
  type: row
  children:
    - { type: stat, label: Weight, property: weight, agg: latest, unit: lb }
    - { type: stat, label: Average, property: weight, agg: mean, back: 7 }
    - { type: stat, label: Lifts, property: lift, agg: count, back: 7, target: 3 }
    - { type: stat, label: Miles, property: miles, agg: sum }
    - { type: stat, label: Nothing, property: nosuchprop, agg: latest }
`).root.children as never);

const tiles = stats.byClass("udash-tile");

check("one card per tile", tiles.length === 5, `${tiles.length}`);

const values = stats.byClass("udash-tile-value").map((e) => e.text);

check("missing property renders as dash", values[4] === "—", JSON.stringify(values[4]));

check("latest weight is numeric", /^\d+\.\d$/.test(values[0]), values[0]);

check("count is a whole number", /^\d+$/.test(values[2]), values[2]);

check("target rendered", stats.byClass("udash-tile-target").length === 1);

console.log(`         values: ${JSON.stringify(values)}`);

console.log("\nheatmap widget");

const hm = new El();

renderHeatmap(hm, days, { id: "t", type: "heatmap", property: "lift", title: "Lifting", year: 2026 });

const boxes = hm.byClass("udash-box");

const pads = hm.byClass("udash-box-pad");

check("365 day cells for 2026 plus lead padding", boxes.length - pads.length === 365, `${boxes.length - pads.length}`);

const filled = boxes.filter((b) => b.style["backgroundColor"]);

check("lift days shaded", filled.length > 0, `${filled.length} shaded`);

check("month labels present", hm.byClass("udash-month").length === 12);

const hmMiles = new El();

renderHeatmap(hmMiles, days, { id: "t", type: "heatmap", property: "miles", intensity: "miles", year: 2026 });

const shades = new Set(hmMiles.byClass("udash-box").map((b) => b.style["backgroundColor"]).filter(Boolean));

check("intensity produces varied shading", shades.size > 1, `${shades.size} distinct shades`);

console.log("\nheatmap ranges");

{
	const boxesOf = (widget: Parameters<typeof renderHeatmap>[2]) => {
		const e = new El();
		renderHeatmap(e, days, widget);
		const all = e.byClass("udash-box");

		return { total: all.length, pads: e.byClass("udash-box-pad").length, el: e };
	};

	const y = boxesOf({ id: "t", type: "heatmap", property: "lift", year: 2026 });
	check("year gives 365 day cells", y.total - y.pads === 365, `${y.total - y.pads}`);

	const d90 = boxesOf({ id: "t", type: "heatmap", property: "lift", back: 90 });
	check("back: 90 gives 90 cells", d90.total - d90.pads === 90, `${d90.total - d90.pads}`);

	const m6 = boxesOf({ id: "t", type: "heatmap", property: "lift", months: 6 });
	const span6 = m6.total - m6.pads;
	check("months: 6 spans about half a year", span6 >= 180 && span6 <= 185, `${span6} days`);

	const exact = boxesOf({ id: "t", type: "heatmap", property: "lift", from: "2026-03-01", to: "2026-03-31" });
	check("from/to is inclusive", exact.total - exact.pads === 31, `${exact.total - exact.pads}`);
	check("month label present for a one month window", exact.el.byClass("udash-month").length === 1);

	// a window starting mid-month should still be labelled
	const mid = boxesOf({ id: "t", type: "heatmap", property: "lift", from: "2026-03-15", to: "2026-04-10" });
	check("partial first month still labelled", mid.el.byClass("udash-month").length === 2,
		`${mid.el.byClass("udash-month").length} labels`);

	const cross = boxesOf({ id: "t", type: "heatmap", property: "lift", from: "2025-11-01", to: "2026-02-28" });
	const labels = cross.el.byClass("udash-month").map((e) => e.text);
	check("cross-year labels carry the year", labels.every((l) => /\s\d{2}$/.test(l)), labels.join(" "));

	// values outside the window must not be counted
	const narrow = new El();
	renderHeatmap(narrow, days, { id: "t", type: "heatmap", property: "lift", from: "2026-01-01", to: "2026-01-02" });
	const shadedNarrow = narrow.byClass("udash-box").filter((b) => b.style["backgroundColor"]).length;
	check("out-of-window days excluded", shadedNarrow === 0, `${shadedNarrow} shaded`);

	check("grid columns set from the window", !!exact.el.byClass("udash-heatmap-boxes")[0].style["gridTemplateColumns"]);
}

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, year: 2026, months: 6 }]", "two ranges rejected");

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, months: 0 }]", "months 0 rejected");

rejects("layout:\n  type: column\n  children: [{ type: heatmap, property: lift, days: -3 }]", "negative days rejected");

rejects('layout:\n  type: column\n  children: [{ type: heatmap, property: lift, from: "nope" }]', "bad date rejected");

rejects('layout:\n  type: column\n  children: [{ type: heatmap, property: lift, from: "2026-06-01", to: "2026-01-01" }]', "reversed window rejected");

console.log("\nline widget");

const line = new El();

renderLine(line, days, { id: "t", type: "line", property: "weight", rolling: 7, unit: "lb" });

const svg = line.all.find((e) => e.tag === "svg");

check("svg emitted", !!svg);

const circles = svg ? svg.children.filter((c) => c.tag === "circle").length : 0;

const paths = svg ? svg.children.filter((c) => c.tag === "path") : [];

check("a dot per reading", circles > 0, `${circles} dots`);

check("rolling average path drawn", paths.length === 1 && !!paths[0].attrs.d);

check("path has no NaN", !!paths[0] && !/NaN|Infinity|undefined/.test(paths[0].attrs.d), paths[0]?.attrs.d.slice(0, 30));

const sparse = new El();

renderLine(sparse, [days[0]], { id: "t", type: "line", property: "weight" });

check("single reading degrades gracefully", sparse.byClass("udash-empty").length === 1);

console.log("\nnote widget");

{
	const shell = new El();
	const body = renderNote(shell, { id: "t", type: "note", path: "0 All/Health.md", height: 240 });

	check("body scrolls within the declared height", body.style.maxHeight === "240px", body.style.maxHeight);
	check("body starts with a placeholder", body.byClass("udash-empty").length === 1);
	check("header falls back to the path", shell.all.some((e) => e.text === "0 All/Health.md"));

	const titled = new El();
	renderNote(titled, { id: "t", type: "note", path: "0 All/Health.md", title: "Plan" });

	check("a title wins over the path", titled.all.some((e) => e.text === "Plan"));

	const unsized = new El();
	const unsizedBody = renderNote(unsized, { id: "t", type: "note", path: "x.md" });

	check("height defaults rather than growing unbounded", unsizedBody.style.maxHeight === "320px", unsizedBody.style.maxHeight);

	check("a note with no path needs setup", needsSetup({ id: "t", type: "note", path: "" } as never));

	// frontmatter is stripped so a tile shows prose, not a property table
	check("frontmatter is dropped", stripFrontmatter("---\nweight: 180\n---\nBody text") === "Body text");
	check("crlf frontmatter is dropped", stripFrontmatter("---\r\nweight: 180\r\n---\r\nBody") === "Body");
	check("a note without frontmatter is untouched", stripFrontmatter("# Title\n\nBody") === "# Title\n\nBody");
	check("a horizontal rule mid-note survives", stripFrontmatter("Intro\n\n---\n\nMore") === "Intro\n\n---\n\nMore");
	check("only the first block goes", stripFrontmatter("---\na: 1\n---\ntext\n---\nmore") === "text\n---\nmore");
}

console.log("\nblank nodes from the palette");

{
	// the palette offers every registered kind, so dropping one has to create
	// that kind. This used to fall through to a Month widget for anything the
	// factory had no branch for, silently.
	for (const kind of WIDGET_KINDS) {
		check(`dropping ${kind} creates a ${kind}`, newNode(kind).type === kind, newNode(kind).type);
	}

	for (const kind of CONTAINER_KINDS) {
		const node = newNode(kind);

		check(`dropping ${kind} creates an empty ${kind}`,
			node.type === kind && isContainer(node) && node.children.length === 0);
	}

	// a fresh widget with required fields must read as incomplete, so the editor
	// opens its form instead of saving a widget that cannot render
	for (const kind of WIDGET_KINDS) {
		const wants = specFor(kind).fields.some((f) => f.required);

		check(`a new ${kind} ${wants ? "opens its form" : "needs no setup"}`,
			needsSetup(newNode(kind)) === wants);
	}
}

console.log("\nblank widget");

{
	const host = new El();
	renderBlank(host, { id: "t", type: "blank", height: 80 });

	const box = host.byClass("udash-blank")[0];

	check("a box is drawn", !!box);
	check("it stands at the declared height", box?.style.minHeight === "80px", box?.style.minHeight);
	check("it draws nothing inside", box?.children.length === 0);

	const bare = new El();
	renderBlank(bare, { id: "t", type: "blank" });

	check("height defaults rather than collapsing", bare.byClass("udash-blank")[0]?.style.minHeight === "120px");

	// it holds space and nothing else, so it must never ask to be configured
	check("a blank never needs setup", !needsSetup(newNode("blank")));
}

console.log("\nheatmap streak");

{
	// dates are built relative to the real today, so the run is deterministic
	// whenever the suite happens to be run
	const on = (...backs: number[]): DayRecord[] =>
		backs
			.map((b) => ({ date: shiftDate(today(), -b), props: { lift: true } }))
			.sort((a, b) => (a.date < b.date ? -1 : 1));

	const widget = { id: "t", type: "heatmap", property: "lift" } as const;

	check("counts back from today", currentStreak(on(0, 1, 2, 3), widget) === 4,
		String(currentStreak(on(0, 1, 2, 3), widget)));

	check("a gap ends the run", currentStreak(on(0, 1, 3, 4), widget) === 2,
		String(currentStreak(on(0, 1, 3, 4), widget)));

	// the day is not over: an unlogged today must not read as a broken streak
	check("today still pending keeps the run", currentStreak(on(1, 2, 3), widget) === 3,
		String(currentStreak(on(1, 2, 3), widget)));

	check("two days idle breaks it", currentStreak(on(2, 3, 4), widget) === 0,
		String(currentStreak(on(2, 3, 4), widget)));

	check("nothing logged is zero", currentStreak([], widget) === 0);

	check("a single day today counts", currentStreak(on(0), widget) === 1);

	// a windowed heatmap must not report a shorter streak than the real one
	const long = on(...Array.from({ length: 400 }, (_, i) => i));

	check("the window does not clip the run",
		currentStreak(long, { ...widget, months: 6 }) === 400,
		String(currentStreak(long, { ...widget, months: 6 })));

	// a falsy value is not a logged day
	const mixed: DayRecord[] = [
		{ date: shiftDate(today(), -1), props: { lift: false } },
		{ date: today(), props: { lift: true } },
	];

	check("a false value does not count", currentStreak(mixed, widget) === 1,
		String(currentStreak(mixed, widget)));

	// shading by a numeric property fills a box, so it must extend a streak too
	const byIntensity: DayRecord[] = [
		{ date: shiftDate(today(), -1), props: { miles: 3 } },
		{ date: today(), props: { miles: 2 } },
	];

	check("a shaded day counts even without the flag",
		currentStreak(byIntensity, { ...widget, intensity: "miles" }) === 2,
		String(currentStreak(byIntensity, { ...widget, intensity: "miles" })));

	const shown = new El();
	renderHeatmap(shown, on(0, 1, 2), { ...widget, streak: true });

	check("the header shows the run", shown.byClass("udash-heatmap-streak")[0]?.text === "3 in a row",
		shown.byClass("udash-heatmap-streak")[0]?.text);

	const hidden = new El();
	renderHeatmap(hidden, on(0, 1, 2), widget);

	check("no streak element unless asked", hidden.byClass("udash-heatmap-streak").length === 0);
}

console.log("\nweather");

{
	// captured from Open-Meteo, so the parser is checked against the real shape
	const GEOCODE = JSON.parse(`{"results":[{"id":5419384,"name":"Denver","latitude":39.73915,
		"longitude":-104.9847,"country_code":"US","timezone":"America/Denver","country":"United States",
		"admin1":"Colorado","admin2":"Denver"}]}`.replace(/\n\s*/g, ""));

	const FORECAST = JSON.parse(`{"latitude":39.746895,"longitude":-104.987076,"timezone":"America/Denver",
		"current_units":{"time":"iso8601","temperature_2m":"°F","apparent_temperature":"°F",
		"weather_code":"wmo code","is_day":""},
		"current":{"time":"2026-09-12T22:00","temperature_2m":66.9,"apparent_temperature":63.8,
		"weather_code":0,"is_day":0},
		"daily_units":{"time":"iso8601","temperature_2m_max":"°F"},
		"daily":{"time":["2026-09-12","2026-09-13","2026-09-14","2026-09-15"],
		"weather_code":[3,3,3,53],"temperature_2m_max":[81.8,94.6,85.3,74.9],
		"temperature_2m_min":[55.7,55.1,68.2,59.3],
		"precipitation_probability_max":[3,6,29,45]}}`.replace(/\n\s*/g, ""));

	const places = parsePlaces(GEOCODE);

	check("a place resolves", places.length === 1 && places[0].name === "Denver, Colorado, United States",
		places[0]?.name);
	check("coordinates come through", places[0]?.latitude === 39.73915 && places[0]?.longitude === -104.9847);
	check("no match is empty, not an error", parsePlaces({}).length === 0);

	const forecast = parseForecast(FORECAST);

	check("current temperature parsed", forecast.current.temperature === 66.9, String(forecast.current.temperature));
	check("night is detected from is_day", forecast.current.isDay === false);
	check("the unit is read off the response", forecast.unit === "°F", forecast.unit);
	check("every forecast day parsed", forecast.days.length === 4, String(forecast.days.length));
	check("highs and lows line up",
		forecast.days[1].high === 94.6 && forecast.days[1].low === 55.1);

	// a malformed response must say so rather than render nonsense
	let threw = false;

	try {
		parseForecast({ current: {}, daily: {}, current_units: {} });
	} catch (e) {
		threw = e instanceof WeatherError;
	}

	check("a malformed response is rejected", threw);

	check("a known code reads as words", describeWeather(3).label === "Overcast", describeWeather(3).label);
	check("clear at night is not a sun", describeWeather(0, false).icon === "🌙");
	check("clear by day is a sun", describeWeather(0, true).icon === "☀️");
	check("rain at night keeps its glyph", describeWeather(61, false).icon === describeWeather(61, true).icon);
	check("an unknown code reports the number", describeWeather(42).label === "Code 42", describeWeather(42).label);

	const host = new El();
	const body = renderWeather(host, { id: "t", type: "weather", place: "Denver" });

	check("the shell carries the place", host.all.some((e) => e.text === "Denver"));

	fillWeather(body as never, { place: places[0], forecast });

	check("the temperature is rounded", body.byClass("udash-weather-temp")[0]?.text === "67°F",
		body.byClass("udash-weather-temp")[0]?.text);
	check("feels-like is shown when it differs",
		body.byClass("udash-weather-label")[0]?.text === "Clear, feels 64°F",
		body.byClass("udash-weather-label")[0]?.text);

	// today is already the headline, so the strip starts tomorrow
	check("the strip skips today", body.byClass("udash-weather-day").length === 3,
		String(body.byClass("udash-weather-day").length));
	check("a day shows its range", body.byClass("udash-weather-range")[0]?.text === "95/55",
		body.byClass("udash-weather-range")[0]?.text);

	// a 6% chance is not worth the ink; 29% and 45% are
	check("only meaningful rain chances are shown", body.byClass("udash-weather-rain").length === 2,
		String(body.byClass("udash-weather-rain").length));

	const dry = new El();
	fillWeather(dry as never, { place: places[0], forecast: { ...forecast, days: [forecast.days[0]] } });

	check("one day means no strip", dry.byClass("udash-weather-days").length === 0);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);

process.exit(failures === 0 ? 0 : 1);
