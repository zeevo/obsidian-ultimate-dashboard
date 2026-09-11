/* Renders every saved dashboard against the real vault, under node, with a
   minimal DOM. Catches a config that parses but cannot draw. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { DayRecord } from "../src/data";
import { LayoutNode, countPanels, isContainer, parseDashboard } from "../src/layout-tree";
import { DEFAULT_GAP, renderNode } from "../src/layout";

const VAULT = process.argv[2];

if (!VAULT) throw new Error("usage: live <vault path>");

class El {
  children: El[] = [];
  classes = new Set<string>();
  text = "";
  style: Record<string, string> & { setProperty(k: string, v: string): void };
  constructor(public tag = "div", cls?: string) {
    if (cls) cls.split(/\s+/).forEach((c) => this.classes.add(c));
    const st: Record<string, string> = {};
    this.style = new Proxy(st, {
      get: (t, k) => (k === "setProperty" ? (a: string, b: string) => (t[a] = b) : t[k as string]),
      set: (t, k, v) => ((t[k as string] = String(v)), true),
    }) as never;
  }
  private mk(tag: string, o?: { cls?: string; text?: string }) {
    const e = new El(tag, o?.cls);

    if (o?.text) e.text = o.text;
    this.children.push(e);

    return e;
  }
  createDiv(o?: { cls?: string; text?: string }) { return this.mk("div", o); }
  createSpan(o?: { cls?: string; text?: string }) { return this.mk("span", o); }
  createEl(t: string, o?: { cls?: string; text?: string }) { return this.mk(t, o); }
  setText(t: string) { this.text = t; }
  addClass(c: string) { this.classes.add(c); }
  removeClass(c: string) { this.classes.delete(c); }
  toggleClass(c: string, on: boolean) { if (on) this.classes.add(c); else this.classes.delete(c); }
  hasClass(c: string) { return this.classes.has(c); }
  setAttr(_k: string, _v: string) {}
  setAttribute(_k: string, _v: string) {}
  appendChild(e: El) { this.children.push(e);

 return e; }
  empty() { this.children = []; }
  get all(): El[] { return this.children.flatMap((c) => [c, ...c.all]); }
  byClass(c: string) { return this.all.filter((e) => e.classes.has(c)); }
  querySelector(sel: string) { return this.byClass(sel.replace(/^\./, ""))[0] ?? null; }
}

(globalThis as { document?: unknown }).document = { createElementNS: (_n: string, t: string) => new El(t) };

const days: DayRecord[] = readdirSync(join(VAULT, "Daily"))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  .map((f) => {
    const txt = readFileSync(join(VAULT, "Daily", f), "utf8");
    const m = /^---\n([\s\S]*?)\n---/.exec(txt);

    return { date: f.replace(/\.md$/, ""), props: m ? ((load(m[1]) as Record<string, unknown>) ?? {}) : {} };
  })
  .sort((a, b) => (a.date < b.date ? -1 : 1));

const data = JSON.parse(
  readFileSync(join(VAULT, ".obsidian/plugins/ultimate-dashboard/data.json"), "utf8"),
);

console.log(`daily notes: ${days.length}\n`);

let bad = 0;

const outline = (n: LayoutNode, depth = 0): void => {
  const pad = "  ".repeat(depth + 1);
  const size = n.flex !== undefined ? ` flex=${n.flex}` : "";

  if (isContainer(n)) {
    console.log(`${pad}${n.type}${n.gap !== undefined ? ` gap=${n.gap}` : ""}${size}`);
    n.children.forEach((c) => outline(c, depth + 1));
  } else {
    console.log(`${pad}${n.type}${size}`);
  }
};

for (const dash of data.dashboards) {
  console.log(`--- ${dash.name} ---`);

  try {
    const cfg = parseDashboard(dash.config);
    outline(cfg.root);
    const host = new El();
    let errors = 0;
    renderNode(host as never, cfg.root, days, DEFAULT_GAP, () => errors++);
    const panels = host.all.filter((e) => e.classes.has("udash-panel")).length;
    console.log(`  rendered ${panels}/${countPanels(cfg.root)} panels, ${errors} errors`);

    if (errors || panels !== countPanels(cfg.root)) bad++;
  } catch (e) {
    console.log(`  BROKEN -> ${(e as Error).message}`);
    bad++;
  }
}

process.exit(bad === 0 ? 0 : 1);
