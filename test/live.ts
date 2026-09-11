/* Parses the dashboard block out of the real note and renders every panel. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { Node, isContainer, parseConfig } from "../src/config";
import { DayRecord } from "../src/data";
import { renderNode } from "../src/layout";

const VAULT = process.argv[2];

class El {
  children: El[] = []; classes = new Set<string>(); attrs: Record<string,string> = {}; text = "";
  style: Record<string,string> & { setProperty(k:string,v:string):void };
  constructor(public tag = "div", cls?: string) {
    if (cls) cls.split(/\s+/).forEach((c) => this.classes.add(c));
    const st: Record<string,string> = {};
    this.style = new Proxy(st, { get:(t,k)=> k==="setProperty"?(a:string,b:string)=>(t[a]=b):t[k as string],
      set:(t,k,v)=>((t[k as string]=String(v)),true) }) as never;
  }
  private mk(tag:string,o?:{cls?:string;text?:string}){const e=new El(tag,o?.cls);

 if(o?.text)e.text=o.text; this.children.push(e);

 return e;}
  createDiv(o?:{cls?:string;text?:string}){return this.mk("div",o);} 
  createSpan(o?:{cls?:string;text?:string}){return this.mk("span",o);}
  createEl(t:string,o?:{cls?:string;text?:string}){return this.mk(t,o);}
  setText(t:string){this.text=t;} addClass(c:string){this.classes.add(c);} 
  setAttr(k:string,v:string){this.attrs[k]=v;} setAttribute(k:string,v:string){this.attrs[k]=v;}
  appendChild(e:El){this.children.push(e);

return e;} empty(){this.children=[];}
  get all():El[]{return this.children.flatMap(c=>[c,...c.all]);}
  byClass(c:string){return this.all.filter(e=>e.classes.has(c));}
}

(globalThis as { document?: unknown }).document = { createElementNS: (_n:string,t:string)=>new El(t) };

const days: DayRecord[] = readdirSync(join(VAULT,"Daily")).filter(f=>/^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  .map(f=>{ const t=readFileSync(join(VAULT,"Daily",f),"utf8"); const m=/^---\n([\s\S]*?)\n---/.exec(t);

    return { date:f.replace(/\.md$/,""), props:(m?((load(m[1]) as Record<string,unknown>)??{}):{}) }; })
  .sort((a,b)=>(a.date<b.date?-1:1));

const note = readFileSync(join(VAULT,"0 All/Home.md"),"utf8");

const block = /```dashboard\n([\s\S]*?)```/.exec(note);

if (!block) throw new Error("no dashboard block found in Home.md");

const cfg = parseConfig(block[1]);

console.log(`config OK: folder=${cfg.folder}`);

console.log(`daily notes: ${days.length}\n`);

console.log("layout tree:");

const walk = (n: Node, depth = 0) => {
  const pad = "  ".repeat(depth + 1);
  const size = n.span !== undefined ? ` span=${n.span}` : n.flex !== undefined ? ` flex=${n.flex}` : "";

  if (isContainer(n)) {
    const cols = n.columns !== undefined ? ` columns=${n.columns}` : "";
    const gap = n.gap !== undefined ? ` gap=${n.gap}` : "";
    console.log(`${pad}${n.type}${cols}${gap}${size}`);
    n.children.forEach((c) => walk(c, depth + 1));
  } else {
    const title = (n as { title?: string }).title ?? (n as { property?: string }).property ?? "";
    console.log(`${pad}${n.type} ${title}${size}`);
  }
};

walk(cfg.root);

const host = new El();

let errors = 0;

renderNode(host as never, cfg.root, days, 20, (el, m) => { errors++; console.log("  ERROR " + m); });

console.log("\nrendered:");

console.log(`  panels:        ${host.all.filter(e => e.classes.has("lifedash-panel")).length}`);

console.log(`  heatmap boxes: ${host.byClass("lifedash-box").length}`);

console.log(`  shaded days:   ${host.byClass("lifedash-box").filter(b => b.style["backgroundColor"]).length}`);

console.log(`  tiles:         ${host.byClass("lifedash-tile").length}`);

console.log(`  svg charts:    ${host.all.filter(e => e.tag === "svg").length}`);

console.log(`  errors:        ${errors}`);

process.exit(errors ? 1 : 0);
