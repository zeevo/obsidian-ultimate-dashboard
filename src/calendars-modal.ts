import { App, Modal, Setting } from "obsidian";
import { AddCalendarModal } from "./add-calendar";
import { DashboardSettings } from "./store";

export interface CalendarsHost {
	settings: DashboardSettings;
	saveSettings(): Promise<void>;
	refreshViews(): void;
	invalidateCalendars(): void;
}

/**
 * The calendar pool: every feed and connected Google account, shared by all
 * dashboards. Opened from wherever calendars come up, rather than living in a
 * settings tab of its own.
 */
export class CalendarsModal extends Modal {
	constructor(
		app: App,
		private host: CalendarsHost,
		private onDone: () => void = () => {},
	) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone();
	}

	private render(): void {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.createEl("h3", { text: "Calendars" });
		this.displayCalendars(contentEl);
		this.displayGoogle(contentEl);
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
							this.render();
						}),
				);
		}
	}

	/** Calendar feeds, shared by every dashboard. */
	private displayCalendars(containerEl: HTMLElement): void {
		const { settings } = this.host;

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
							this.render();
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
						this.render();
					}),
			);
		}

		new Setting(containerEl)
			.addButton((b) =>
				b
					.setButtonText("Add calendar")
					.setCta()
					.onClick(() => {
						new AddCalendarModal(this.app, this.host, () => this.render()).open();
					}),
			)
			.addButton((b) =>
				b.setButtonText("Refresh now").onClick(() => {
					this.host.invalidateCalendars();
					this.host.refreshViews();
				}),
			);
	}
}
