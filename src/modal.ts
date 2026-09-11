import { App, Modal, Notice, Setting } from "obsidian";
import { NewEvent } from "./google";

/** Asks for a dashboard name. Resolves with the name, or null if cancelled. */
export class NameModal extends Modal {
	private value: string;
	private submitted = false;

	constructor(
		app: App,
		private opts: { title: string; cta: string; initial?: string },
		private onSubmit: (name: string) => void,
	) {
		super(app);
		this.value = opts.initial ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.opts.title });

		const setting = new Setting(contentEl).setName("Name").addText((text) => {
			text.setPlaceholder("Health").setValue(this.value);
			text.onChange((v) => (this.value = v));
			text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit();
				}
			});
			// focus once the modal is actually on screen
			window.setTimeout(() => text.inputEl.select(), 0);
		});

		setting.controlEl.addClass("udash-name-control");

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.opts.cta).setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		const name = this.value.trim();

		if (!name) return;
		this.submitted = true;
		this.close();
		this.onSubmit(name);
	}

	onClose(): void {
		this.contentEl.empty();

		if (!this.submitted) this.value = "";
	}
}

/** Confirms a destructive action. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private opts: { title: string; body: string; cta: string },
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.opts.title });
		contentEl.createEl("p", { text: this.opts.body });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.opts.cta)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const pad = (n: number) => String(n).padStart(2, "0");

const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Collects a new event. Times are local; the caller converts for the API. */
export class EventModal extends Modal {
	private summary = "";
	private date: string;
	private startTime: string;
	private endTime: string;
	private allDay = false;
	private location = "";
	private calendarId: string;
	private accountId: string;

	constructor(
		app: App,
		private targets: { id: string; accountId: string; name: string }[],
		private onSubmit: (accountId: string, calendarId: string, event: NewEvent) => Promise<void>,
		/** Pre-selects a day, for a click on a month cell. */
		on?: Date,
	) {
		super(app);
		const now = new Date();

		now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
		this.date = toDateInput(on ?? now);
		this.startTime = toTimeInput(now);
		this.endTime = toTimeInput(new Date(now.getTime() + 3600000));
		this.calendarId = targets[0]?.id ?? "";
		this.accountId = targets[0]?.accountId ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl("h3", { text: "New event" });

		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Dentist").onChange((v) => (this.summary = v));
			t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});

		if (this.targets.length > 1) {
			new Setting(contentEl).setName("Calendar").addDropdown((dd) => {
				for (const t of this.targets) dd.addOption(t.id, t.name);
				dd.setValue(this.calendarId);
				dd.onChange((v) => {
					this.calendarId = v;
					this.accountId = this.targets.find((t) => t.id === v)?.accountId ?? this.accountId;
				});
			});
		}

		new Setting(contentEl).setName("Date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.date).onChange((v) => (this.date = v));
		});

		const times = new Setting(contentEl).setName("Time");

		times.addText((t) => {
			t.inputEl.type = "time";
			t.setValue(this.startTime).onChange((v) => (this.startTime = v));
		});
		times.addText((t) => {
			t.inputEl.type = "time";
			t.setValue(this.endTime).onChange((v) => (this.endTime = v));
		});

		new Setting(contentEl).setName("All day").addToggle((t) =>
			t.setValue(this.allDay).onChange((v) => {
				this.allDay = v;
				times.settingEl.toggleClass("is-hidden", v);
			}),
		);

		new Setting(contentEl)
			.setName("Location")
			.addText((t) => t.onChange((v) => (this.location = v)));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => void this.submit()));
	}

	private async submit(): Promise<void> {
		if (!this.summary.trim()) {
			new Notice("Give the event a title");

			return;
		}

		const [y, m, d] = this.date.split("-").map(Number);

		const at = (hhmm: string) => {
			const [hh, mi] = hhmm.split(":").map(Number);

			return new Date(y, m - 1, d, hh || 0, mi || 0);
		};

		const start = this.allDay ? new Date(y, m - 1, d) : at(this.startTime);
		let end = this.allDay ? new Date(y, m - 1, d + 1) : at(this.endTime);

		// an end at or before the start would be rejected by the API
		if (!this.allDay && end <= start) end = new Date(start.getTime() + 3600000);

		this.close();

		try {
			await this.onSubmit(this.accountId, this.calendarId, {
				summary: this.summary.trim(),
				start,
				end,
				allDay: this.allDay,
				location: this.location.trim() || undefined,
			});
			new Notice("Event created");
		} catch (e) {
			// SAFETY: the create path throws Errors; anything else still stringifies.
			new Notice(`Could not create the event: ${(e as Error).message}`, 8000);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
