import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { AddCalendarModal } from "./add-calendar";
import { CONTAINER_KINDS, WIDGET_KINDS } from "./kinds";
import { ConfigError, countWidgets, parseDashboard } from "./layout-tree";
import { RANGE_KEYS } from "./widgets";
import { ConfirmModal, NameModal } from "./modal";
import {
	DEFAULT_CONFIG,
	DashboardSettings,
	activeDashboard,
	makeDashboard,
	uniqueName,
} from "./store";

export interface SettingsHost {
	settings: DashboardSettings;
	saveSettings(): Promise<void>;
	refreshViews(): void;
	invalidateCalendars(): void;
}

export class DashboardSettingTab extends PluginSettingTab {
	private status: HTMLElement | null = null;

	constructor(
		app: App,
		// the plugin itself is the host, so no cast is needed to satisfy the base
		private host: SettingsHost & Plugin,
	) {
		super(app, host);
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.host;
		containerEl.empty();

		const current = activeDashboard(settings);

		new Setting(containerEl)
			.setName("Dashboard")
			.setDesc("Which dashboard to edit. The view shows this one too.")
			.addDropdown((dd) => {
				for (const d of settings.dashboards) dd.addOption(d.id, d.name);
				dd.setValue(current?.id ?? "");
				dd.onChange(async (id) => {
					settings.activeId = id;
					await this.host.saveSettings();
					this.host.refreshViews();
					this.display();
				});
			})
			.addButton((b) =>
				b
					.setButtonText("New")
					.setCta()
					.onClick(() => {
						new NameModal(this.app, { title: "New dashboard", cta: "Create" }, async (name) => {
							const created = makeDashboard(uniqueName(settings, name));
							settings.dashboards.push(created);
							settings.activeId = created.id;
							await this.host.saveSettings();
							this.host.refreshViews();
							this.display();
						}).open();
					}),
			);

		if (!current) {
			containerEl.createEl("p", { text: "No dashboards yet. Use New to make one." });

			return;
		}

		new Setting(containerEl)
			.setName(current.name)
			.setDesc("Rename, duplicate, or delete this dashboard.")
			.addButton((b) =>
				b.setButtonText("Rename").onClick(() => {
					new NameModal(
						this.app,
						{ title: "Rename dashboard", cta: "Rename", initial: current.name },
						async (name) => {
							current.name = uniqueName(settings, name);
							await this.host.saveSettings();
							this.host.refreshViews();
							this.display();
						},
					).open();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Duplicate").onClick(async () => {
					const copy = makeDashboard(uniqueName(settings, current.name), current.config);
					settings.dashboards.push(copy);
					settings.activeId = copy.id;
					await this.host.saveSettings();
					this.host.refreshViews();
					this.display();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText("Delete")
					.setWarning()
					.setDisabled(settings.dashboards.length <= 1)
					.onClick(() => {
						new ConfirmModal(
							this.app,
							{
								title: `Delete "${current.name}"?`,
								body: "This removes the dashboard and its layout. It cannot be undone.",
								cta: "Delete",
							},
							async () => {
								settings.dashboards = settings.dashboards.filter((d) => d.id !== current.id);
								settings.activeId = settings.dashboards[0]?.id ?? "";

								if (settings.startupId === current.id) settings.startupId = undefined;
								await this.host.saveSettings();
								this.host.refreshViews();
								this.display();
							},
						).open();
					}),
			);

		new Setting(containerEl)
			.setName("Open on startup")
			.setDesc("Which dashboard opens when Obsidian starts. Applies to every dashboard, not just this one.")
			.addDropdown((dd) => {
				dd.addOption("", "Nothing");

				for (const d of settings.dashboards) dd.addOption(d.id, d.name);
				dd.setValue(settings.startupId ?? "");
				dd.onChange(async (value) => {
					settings.startupId = value || undefined;
					await this.host.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Layout")
			.setDesc("YAML describing the widgets. Saved as you type. The dashboard tab has the same editor behind its pencil button.")
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Restore the default layout")
					.onClick(async () => {
						current.config = DEFAULT_CONFIG;
						await this.host.saveSettings();
						this.host.refreshViews();
						this.display();
					}),
			);

		const editor = containerEl.createEl("textarea", { cls: "udash-config-editor" });
		editor.value = current.config;
		editor.rows = 22;
		editor.spellcheck = false;

		this.status = containerEl.createDiv({ cls: "udash-config-status" });
		this.validate(editor.value);

		editor.addEventListener("input", async () => {
			current.config = editor.value;
			await this.host.saveSettings();

			// Only redraw on a config that parses, so a half-typed line does not
			// replace the dashboard with an error while you are still editing.
			if (this.validate(editor.value)) this.host.refreshViews();
		});

		new Setting(containerEl).setName("Reference").setDesc(
			`Widgets: ${WIDGET_KINDS.join(", ")}. Containers: ${CONTAINER_KINDS.join(", ")}. ` +
				`Ranges: ${RANGE_KEYS.join(", ")}. See the plugin README for the full list.`,
		);

		this.displayCalendars(containerEl);
		this.displayGoogle(containerEl);
	}

	/** Connected Google accounts. Adding one happens in the Add calendar flow. */
	private displayGoogle(containerEl: HTMLElement): void {
		const { settings } = this.host;
		const g = settings.google;

		if (g.accounts.length === 0) return;

		new Setting(containerEl).setName("Google accounts").setHeading();

		for (const account of g.accounts) {
			const owned = settings.calendars.filter((c) => c.accountId === account.id).length;

			new Setting(containerEl)
				.setName(account.email ?? "Google account")
				.setDesc(`${owned} calendar(s) in the pool`)
				.addButton((b) =>
					b
						.setButtonText("Disconnect")
						.setWarning()
						.onClick(async () => {
							g.accounts = g.accounts.filter((a) => a.id !== account.id);
							settings.calendars = settings.calendars.filter(
								(c) => c.accountId !== account.id,
							);
							await this.host.saveSettings();
							this.host.invalidateCalendars();
							this.display();
						}),
				);
		}
	}

	/** Calendar feeds, shared by every dashboard. */
	private displayCalendars(containerEl: HTMLElement): void {
		const { settings } = this.host;

		new Setting(containerEl).setName("Calendars").setHeading();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Google accounts and ICS feeds share one pool. Every dashboard draws from it, " +
				"and a calendar widget picks which to show by name.",
		});

		for (const cal of settings.calendars) {
			const row = new Setting(containerEl);

			if (cal.type === "google") {
				row.setName(cal.name).setDesc(`Google \u00b7 ${cal.calendarId ?? ""}`);
				row.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip("Remove this calendar")
						.onClick(async () => {
							settings.calendars = settings.calendars.filter((c) => c.id !== cal.id);
							await this.host.saveSettings();
							this.host.invalidateCalendars();
							this.display();
						}),
				);

				continue;
			}

			row.addText((t) =>
				t
					.setPlaceholder("Name")
					.setValue(cal.name)
					.onChange(async (v) => {
						cal.name = v.trim() || "Calendar";
						await this.host.saveSettings();
					}),
			);
			row.addText((t) => {
				t.setPlaceholder("https://calendar.google.com/calendar/ical/.../basic.ics")
					.setValue(cal.url ?? "")
					.onChange(async (v) => {
						cal.url = v.trim();
						await this.host.saveSettings();
						this.host.invalidateCalendars();
					});
				t.inputEl.addClass("udash-url-input");
			});
			row.addColorPicker((c) =>
				c.setValue(cal.color ?? "#3b82f6").onChange(async (v) => {
					cal.color = v;
					await this.host.saveSettings();
					this.host.refreshViews();
				}),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove this calendar")
					.onClick(async () => {
						settings.calendars = settings.calendars.filter((c) => c.id !== cal.id);
						await this.host.saveSettings();
						this.host.invalidateCalendars();
						this.display();
					}),
			);
		}

		new Setting(containerEl)
			.addButton((b) =>
				b
					.setButtonText("Add calendar")
					.setCta()
					.onClick(() => {
						new AddCalendarModal(this.app, this.host, () => this.display()).open();
					}),
			)
			.addButton((b) =>
				b.setButtonText("Refresh now").onClick(() => {
					this.host.invalidateCalendars();
					this.host.refreshViews();
				}),
			);
	}

	/** Shows a parse error under the editor. Returns whether the config is usable. */
	private validate(source: string): boolean {
		if (!this.status) return false;
		this.status.empty();

		try {
			const config = parseDashboard(source);
			const count = countWidgets(config.root);
			this.status.addClass("is-valid");
			this.status.removeClass("is-error");
			this.status.setText(`Valid: ${count} ${count === 1 ? "widget" : "widgets"}.`);

			return true;
		} catch (e) {
			this.status.removeClass("is-valid");
			this.status.addClass("is-error");
			this.status.setText(e instanceof ConfigError ? e.message : String(e));

			return false;
		}
	}
}
