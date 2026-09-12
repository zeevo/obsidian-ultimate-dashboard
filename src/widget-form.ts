import { App, Modal, Setting } from "obsidian";
import { LayoutNode, isContainer } from "./layout-tree";
import { ContainerKind, assertNever } from "./kinds";
import { specFor } from "./widgets";
import { Field, FieldKind, FieldValue } from "./schema";

/**
 * The configuration form, generated from a widget's declared fields.
 *
 * There is no per-type branching here: a new widget type gets a form for free by
 * declaring its fields in the registry.
 */

export interface FormContext {
	properties: string[];
	calendars: string[];
	notes: string[];
}

export class WidgetForm extends Modal {
	onDismiss: (() => void) | null = null;

	constructor(
		app: App,
		private node: LayoutNode,
		private context: FormContext,
		private onSave: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const node = this.node;

		if (isContainer(node)) {
			contentEl.createEl("h3", { text: "Container" });
			this.containerFields(node);
		} else {
			const spec = specFor(node.type);

			contentEl.createEl("h3", { text: `${spec.label} widget` });

			for (const field of spec.fields) this.field(field, node);

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

	/* ---------------------------------------------------------- containers */

	private containerFields(node: Extract<LayoutNode, { children: unknown }>): void {
		new Setting(this.contentEl)
			.setName("Layout")
			.setDesc("How this container arranges its children.")
			.addDropdown((dd) => {
				dd.addOption(ContainerKind.Column, "Rows, stacked");
				dd.addOption(ContainerKind.Row, "Columns, side by side");
				dd.setValue(node.type);
				dd.onChange((v) => {
					node.type = v === ContainerKind.Row ? ContainerKind.Row : ContainerKind.Column;

					// `wrap` is a row option; leaving it on a column is rejected on save
					if (node.type !== ContainerKind.Row) delete node.wrap;
					this.contentEl.empty();
					this.onOpen();
				});
			});

		this.numberControl("Gap (px)", () => node.gap, (v) => (node.gap = v), 0);

		if (node.type === ContainerKind.Row) {
			new Setting(this.contentEl)
				.setName("Wrap onto more lines")
				.addToggle((t) => t.setValue(node.wrap !== false).onChange((v) => (node.wrap = v ? undefined : false)));
		}
	}

	/* -------------------------------------------------------------- fields */

	/** One control, chosen by the field's declared kind. */
	private field<P>(field: Field<P>, node: LayoutNode): void {
		// SAFETY: as in the serialiser, the keys come from this widget's own spec.
		const bag = node as unknown as Record<string, FieldValue | undefined>;
		const get = () => bag[field.key];

		const put = (v: FieldValue | undefined) => {
			if (v === undefined || v === "") delete bag[field.key];
			else bag[field.key] = v;
		};

		const setting = new Setting(this.contentEl).setName(field.label);

		if (field.hint) setting.setDesc(field.hint);

		switch (field.kind) {
			case FieldKind.Text:
			case FieldKind.Colour:
				setting.addText((t) =>
					t
						.setPlaceholder(field.placeholder ?? "")
						.setValue(String(get() ?? ""))
						.onChange((v) => put(v.trim() || undefined)),
				);

				return;

			case FieldKind.Property:
				setting.addText((t) => {
					t.setPlaceholder(field.placeholder ?? "weight")
						.setValue(String(get() ?? ""))
						.onChange((v) => put(v.trim() || undefined));
					this.suggest(t.inputEl, this.context.properties);
				});

				return;

			case FieldKind.Note:
				setting.addText((t) => {
					t.setPlaceholder(field.placeholder ?? "")
						.setValue(String(get() ?? ""))
						.onChange((v) => put(v.trim() || undefined));
					this.suggest(t.inputEl, this.context.notes);
				});

				return;

			case FieldKind.Number:
				setting.addText((t) => {
					t.inputEl.type = "number";
					t.setValue(get() === undefined ? "" : String(get())).onChange((v) => {
						const n = Number(v);

						put(v.trim() && Number.isFinite(n) ? Math.round(n) : undefined);
					});
				});

				return;

			case FieldKind.Toggle:
				setting.addToggle((t) => t.setValue(get() === true).onChange((v) => put(v || undefined)));

				return;

			case FieldKind.Month:
			case FieldKind.Date:
				setting.addText((t) => {
					t.inputEl.type = field.kind === FieldKind.Date ? "date" : "text";
					t.setPlaceholder(field.kind === FieldKind.Date ? "2026-09-30" : "2026-09")
						.setValue(String(get() ?? ""))
						.onChange((v) => put(v.trim() || undefined));
				});

				return;

			case FieldKind.Choice:
				setting.addDropdown((dd) => {
					dd.addOption("", "Default");

					for (const c of field.choices) dd.addOption(c.value, c.label);
					dd.setValue(String(get() ?? ""));
					dd.onChange((v) => put(v || undefined));
				});

				return;

			case FieldKind.Calendars: {
				const chosen = new Set<string>(Array.isArray(get()) ? (get() as string[]) : []);

				setting.setDesc("None selected means every configured calendar.");

				for (const name of this.context.calendars) {
					new Setting(this.contentEl).setName(name).addToggle((t) =>
						t.setValue(chosen.has(name)).onChange((v) => {
							if (v) chosen.add(name);
							else chosen.delete(name);
							put(chosen.size ? [...chosen] : undefined);
						}),
					);
				}

				return;
			}

			default:
				assertNever(field, "WidgetForm.field");
		}
	}

	private numberControl(
		name: string,
		get: () => number | undefined,
		put: (v: number | undefined) => void,
		min: number,
	): void {
		new Setting(this.contentEl).setName(name).addText((t) => {
			t.inputEl.type = "number";
			t.setValue(get() === undefined ? "" : String(get())).onChange((v) => {
				const n = Number(v);

				put(v.trim() && Number.isFinite(n) && n >= min ? Math.round(n) : undefined);
			});
		});
	}

	private suggest(input: HTMLInputElement, options: string[]): void {
		const list = input.parentElement?.createEl("datalist");

		if (!list) return;
		list.id = `udash-suggest-${Math.random().toString(36).slice(2, 8)}`;
		input.setAttr("list", list.id);

		for (const o of options) list.createEl("option", { value: o });
	}

}
