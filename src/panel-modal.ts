import { App, Modal, Setting } from "obsidian";
import { ContainerKind, Node, StatsPanel, isContainer } from "./config";

/**
 * Configures one panel. Opened when a type that needs settings is dropped onto
 * the canvas, and again from a panel's own edit button.
 *
 * Fields are wired with typed getter/setter pairs rather than by string key, so
 * every control is checked against the panel type it belongs to.
 */

interface Context {
	properties: string[];
	calendars: string[];
}

type Get<T> = () => T | undefined;

type Put<T> = (v: T | undefined) => void;

export class PanelModal extends Modal {
	constructor(
		app: App,
		private node: Node,
		private context: Context,
		private onSave: () => void,
	) {
		super(app);
	}

	/** Runs on close however it happened, including Escape. */
	onDismiss: (() => void) | null = null;

	/** Whether dropping this type should prompt before it is usable. */
	static needsSetup(node: Node): boolean {
		if (node.type === "heatmap" || node.type === "line") return !node.property;

		if (node.type === "stats") return node.tiles.length === 0;

		return false;
	}

	onOpen(): void {
		const { contentEl } = this;
		const node = this.node;

		contentEl.createEl("h3", { text: `${label(node.type)} panel` });

		if (node.type === "heatmap") {
			this.text("Title", () => node.title, (v) => (node.title = v));
			this.property("Property", () => node.property, (v) => (node.property = v ?? ""));
			this.property("Shade by", () => node.intensity, (v) => (node.intensity = v), "Optional");
			this.text("Colour", () => node.color, (v) => (node.color = v), "#3b82f6");
			this.number("Months to show", () => node.months, (v) => (node.months = v));
		} else if (node.type === "line") {
			this.text("Title", () => node.title, (v) => (node.title = v));
			this.property("Property", () => node.property, (v) => (node.property = v ?? ""));
			this.number("Rolling average (days)", () => node.rolling, (v) => (node.rolling = v));
			this.text("Unit", () => node.unit, (v) => (node.unit = v), "lb");
			this.number("Months to show", () => node.months, (v) => (node.months = v));
		} else if (node.type === "stats") {
			this.tiles(contentEl, node);
		} else if (node.type === "upcoming") {
			this.text("Title", () => node.title, (v) => (node.title = v));
			this.number("Days ahead", () => node.days, (v) => (node.days = v));
			this.number("Most events", () => node.limit, (v) => (node.limit = v));
			this.calendars(() => node.calendars, (v) => (node.calendars = v));
		} else if (node.type === "calendar") {
			this.text("Title", () => node.title, (v) => (node.title = v));
			this.text("Month", () => node.month, (v) => (node.month = v), "2026-09, or blank");
			this.number("Events per day", () => node.maxPerDay, (v) => (node.maxPerDay = v));
			this.calendars(() => node.calendars, (v) => (node.calendars = v));
		} else {
			new Setting(contentEl)
				.setName("Layout")
				.setDesc("How this container arranges its children.")
				.addDropdown((dd) => {
					dd.addOption("column", "Rows, stacked");
					dd.addOption("row", "Columns, side by side");
					dd.setValue(node.type);
					dd.onChange((v) => {
						retype(node, toKind(v));
						// the available options differ per kind, so redraw the form
						this.contentEl.empty();
						this.onOpen();
					});
				});

			this.number("Gap (px)", () => node.gap, (v) => (node.gap = v));
		}

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Done")
				.setCta()
				.onClick(() => {
					this.close();
					this.onSave();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDismiss?.();
	}

	/* ------------------------------------------------------------- fields */

	private text(name: string, get: Get<string>, put: Put<string>, placeholder = ""): void {
		new Setting(this.contentEl).setName(name).addText((t) =>
			t
				.setPlaceholder(placeholder)
				.setValue(get() ?? "")
				.onChange((v) => put(v.trim() || undefined)),
		);
	}

	private number(name: string, get: Get<number>, put: Put<number>): void {
		new Setting(this.contentEl).setName(name).addText((t) => {
			t.inputEl.type = "number";
			t.setValue(get() === undefined ? "" : String(get())).onChange((v) => {
				const n = Number(v);

				put(v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);
			});
		});
	}

	/** A text field offering the frontmatter keys actually present in the vault. */
	private property(name: string, get: Get<string>, put: Put<string>, placeholder = "weight"): void {
		new Setting(this.contentEl).setName(name).addText((t) => {
			t.setPlaceholder(placeholder)
				.setValue(get() ?? "")
				.onChange((v) => put(v.trim() || undefined));

			const list = t.inputEl.parentElement?.createEl("datalist");

			if (!list) return;
			list.id = `udash-props-${name.replace(/\s+/g, "-").toLowerCase()}`;
			t.inputEl.setAttr("list", list.id);

			for (const p of this.context.properties) list.createEl("option", { value: p });
		});
	}

	private calendars(get: Get<string[]>, put: Put<string[]>): void {
		if (this.context.calendars.length === 0) return;
		const chosen = new Set<string>(get() ?? []);

		new Setting(this.contentEl)
			.setName("Calendars")
			.setDesc("None selected means every configured calendar.");

		for (const name of this.context.calendars) {
			new Setting(this.contentEl).setName(name).addToggle((t) =>
				t.setValue(chosen.has(name)).onChange((v) => {
					if (v) chosen.add(name);
					else chosen.delete(name);
					put(chosen.size ? [...chosen] : undefined);
				}),
			);
		}
	}

	private tiles(contentEl: HTMLElement, panel: StatsPanel): void {
		new Setting(contentEl).setName("Tiles").setHeading();

		panel.tiles.forEach((tile, i) => {
			const row = new Setting(contentEl);

			row.addText((t) =>
				t
					.setPlaceholder("Label")
					.setValue(tile.label)
					.onChange((v) => (tile.label = v.trim() || "Tile")),
			);
			row.addText((t) => {
				t.setPlaceholder("property")
					.setValue(tile.property)
					.onChange((v) => (tile.property = v.trim()));

				const list = t.inputEl.parentElement?.createEl("datalist");

				if (!list) return;
				list.id = `udash-tile-${i}`;
				t.inputEl.setAttr("list", list.id);

				for (const p of this.context.properties) list.createEl("option", { value: p });
			});
			row.addDropdown((dd) => {
				for (const agg of AGGS) dd.addOption(agg, agg);
				dd.setValue(tile.agg);
				dd.onChange((v) => (tile.agg = toAgg(v)));
			});
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						panel.tiles.splice(i, 1);
						this.contentEl.empty();
						this.onOpen();
					}),
			);
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Add tile").onClick(() => {
				panel.tiles.push({ label: "Tile", property: "", agg: "latest" });
				this.contentEl.empty();
				this.onOpen();
			}),
		);
	}
}

const AGGS = ["latest", "mean", "sum", "count", "delta"] as const;

type Agg = (typeof AGGS)[number];

/** Narrows a dropdown value without asserting. */
function toAgg(v: string): Agg {
	return AGGS.find((a) => a === v) ?? "latest";
}

const LABELS = new Map<Node["type"], string>([
	["stats", "Stats"],
	["line", "Line chart"],
	["heatmap", "Heatmap"],
	["upcoming", "Upcoming"],
	["calendar", "Month"],
	["row", "Columns"],
	["column", "Rows"],
]);

export function label(type: Node["type"]): string {
	return LABELS.get(type) ?? type;
}

const KINDS: ContainerKind[] = ["row", "column"];

function toKind(v: string): ContainerKind {
	return KINDS.find((k) => k === v) ?? "column";
}

/**
 * Switches a container between kinds, dropping options the new kind does not
 * understand. Leaving a stale `columns` on a row, say, would be rejected by the
 * parser the next time the layout is saved.
 */
function retype(node: Node, kind: ContainerKind): void {
	if (!isContainer(node)) return;
	node.type = kind;

	// `wrap` is a row option; leaving it on a column is rejected on save
	if (kind !== "row") delete node.wrap;
}
