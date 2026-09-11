import { App, Modal, Notice, Setting } from "obsidian";
import { GoogleCalendarInfo, connect, listCalendars, redirectUri, validToken } from "./google";
import {
	CalendarSource,
	DashboardSettings,
	GoogleAccountRecord,
	makeCalendar,
	makeGoogleCalendar,
	newId,
} from "./store";

export interface AddCalendarHost {
	settings: DashboardSettings;
	saveSettings(): Promise<void>;
	invalidateCalendars(): void;
}

type Step = "choose" | "ics" | "client" | "pick";

/**
 * One flow for adding a calendar, whatever its kind. Google authentication
 * happens inside this modal rather than in a separate settings section, so
 * "Add calendar" is the only thing you need to find.
 */
export class AddCalendarModal extends Modal {
	private step: Step = "choose";
	private icsName = "";
	private icsUrl = "";
	private account: GoogleAccountRecord | null = null;
	private available: GoogleCalendarInfo[] = [];
	private chosen = new Set<string>();

	constructor(
		app: App,
		private host: AddCalendarHost,
		private onDone: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;

		contentEl.empty();

		if (this.step === "choose") return this.renderChoose();

		if (this.step === "ics") return this.renderIcs();

		if (this.step === "client") return this.renderClient();
		this.renderPick();
	}

	/* ------------------------------------------------------------- choose */

	private renderChoose(): void {
		const { contentEl } = this;

		contentEl.createEl("h3", { text: "Add calendar" });

		new Setting(contentEl)
			.setName("Google Calendar")
			.setDesc("Sign in with Google. Read events and create new ones.")
			.addButton((b) =>
				b
					.setButtonText("Connect")
					.setCta()
					.onClick(() => {
						const g = this.host.settings.google;

						this.step = g.clientId && g.clientSecret ? "pick" : "client";

						if (this.step === "pick") void this.beginConnect();
						else this.render();
					}),
			);

		new Setting(contentEl)
			.setName("ICS link")
			.setDesc("Subscribe to a published feed. Read only, works on mobile.")
			.addButton((b) =>
				b.setButtonText("Paste a link").onClick(() => {
					this.step = "ics";
					this.render();
				}),
			);
	}

	/* ---------------------------------------------------------------- ics */

	private renderIcs(): void {
		const { contentEl } = this;

		contentEl.createEl("h3", { text: "Subscribe to an ICS feed" });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"For a Google calendar: Google Calendar > Settings > Settings for my calendars > " +
				"pick one > Integrate calendar > Secret address in iCal format. Treat that URL " +
				"like a password.",
		});

		new Setting(contentEl).setName("Name").addText((t) =>
			t.setPlaceholder("Holidays").onChange((v) => (this.icsName = v)),
		);

		new Setting(contentEl).setName("URL").addText((t) => {
			t.setPlaceholder("https://.../basic.ics").onChange((v) => (this.icsUrl = v));
			t.inputEl.addClass("udash-url-input");
		});

		this.footer("Add", async () => {
			const url = this.icsUrl.trim();

			if (!url) {
				new Notice("Paste the feed URL");

				return false;
			}

			const source = makeCalendar(this.icsName.trim() || "Calendar", url);

			source.color = "#3b82f6";
			this.host.settings.calendars.push(source);
			await this.host.saveSettings();
			this.host.invalidateCalendars();

			return true;
		});
	}

	/* ------------------------------------------------------- google setup */

	private renderClient(): void {
		const { contentEl } = this;
		const g = this.host.settings.google;

		contentEl.createEl("h3", { text: "Connect Google" });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Google needs an OAuth client, and this plugin has no hosted proxy to " +
				"authenticate through, so it uses one you create. In Google Cloud Console: new " +
				"project, enable the Google Calendar API, add yourself as a test user on the " +
				"consent screen, then create an OAuth client of type Desktop app. You only do " +
				"this once, however many accounts you connect.",
		});

		new Setting(contentEl)
			.setName("Redirect URI")
			.setDesc("Add this to the OAuth client, exactly.")
			.addText((t) => {
				t.setValue(redirectUri(g.port));
				t.inputEl.readOnly = true;
				t.inputEl.addClass("udash-url-input");
			});

		new Setting(contentEl).setName("Client ID").addText((t) => {
			t.setPlaceholder("....apps.googleusercontent.com")
				.setValue(g.clientId)
				.onChange((v) => (g.clientId = v.trim()));
			t.inputEl.addClass("udash-url-input");
		});

		new Setting(contentEl).setName("Client secret").addText((t) => {
			t.setPlaceholder("GOCSPX-...")
				.setValue(g.clientSecret)
				.onChange((v) => (g.clientSecret = v.trim()));
			t.inputEl.type = "password";
			t.inputEl.addClass("udash-url-input");
		});

		this.footer("Sign in", async () => {
			if (!g.clientId || !g.clientSecret) {
				new Notice("Both the client ID and secret are needed");

				return false;
			}

			await this.host.saveSettings();
			await this.beginConnect();

			return false;
		});
	}

	/** Runs the OAuth flow, then moves on to picking calendars. */
	private async beginConnect(): Promise<void> {
		const g = this.host.settings.google;

		this.contentEl.empty();
		this.contentEl.createEl("h3", { text: "Waiting for Google…" });
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Approve access in the browser tab that just opened.",
		});

		try {
			const tokens = await connect(g, g.port);
			const existing = g.accounts.find((a) => a.email && a.email === tokens.email);

			if (existing) {
				Object.assign(existing, tokens);
				this.account = existing;
			} else {
				const created: GoogleAccountRecord = { id: newId(), ...tokens };

				g.accounts.push(created);
				this.account = created;
			}

			await this.host.saveSettings();
			await this.loadAvailable();
			this.step = "pick";
			this.render();
		} catch (e) {
			// SAFETY: connect() throws Errors; a non-Error still stringifies.
			new Notice(`Google sign in failed: ${(e as Error).message}`, 8000);
			this.step = "choose";
			this.render();
		}
	}

	private async loadAvailable(): Promise<void> {
		const g = this.host.settings.google;
		const account = this.account;

		if (!account) return;

		const token = await validToken(g, account, async (t) => {
			Object.assign(account, t);
			await this.host.saveSettings();
		});

		this.available = await listCalendars(token);

		// preselect anything not already in the pool
		const already = new Set(
			this.host.settings.calendars
				.filter((c) => c.accountId === account.id)
				.map((c) => c.calendarId),
		);

		for (const cal of this.available) {
			if (!already.has(cal.id)) this.chosen.add(cal.id);
		}
	}

	/* --------------------------------------------------------------- pick */

	private renderPick(): void {
		const { contentEl } = this;
		const account = this.account;

		contentEl.createEl("h3", { text: "Choose calendars" });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Signed in as ${account?.email ?? "your account"}. Pick which calendars to add.`,
		});

		const already = new Set(
			this.host.settings.calendars
				.filter((c) => c.accountId === account?.id)
				.map((c) => c.calendarId),
		);

		for (const cal of this.available) {
			const row = new Setting(contentEl).setName(cal.summary);

			row.setDesc(cal.writable ? "Can add events" : "Read only");

			if (already.has(cal.id)) {
				row.setDesc(`Already added \u00b7 ${cal.writable ? "can add events" : "read only"}`);
				row.setDisabled(true);

				continue;
			}

			row.addToggle((t) =>
				t.setValue(this.chosen.has(cal.id)).onChange((v) => {
					if (v) this.chosen.add(cal.id);
					else this.chosen.delete(cal.id);
				}),
			);
		}

		this.footer("Add selected", async () => {
			if (!account) return true;
			const g = this.host.settings.google;
			let added = 0;

			for (const cal of this.available) {
				if (!this.chosen.has(cal.id) || already.has(cal.id)) continue;

				// disambiguate when two accounts expose the same calendar name
				const label =
					g.accounts.length > 1 && account.email
						? `${cal.summary} (${account.email})`
						: cal.summary;

				const entry: CalendarSource = makeGoogleCalendar(label, account.id, cal.id, cal.writable);

				entry.color = cal.backgroundColor;
				this.host.settings.calendars.push(entry);
				added++;
			}

			await this.host.saveSettings();
			this.host.invalidateCalendars();
			new Notice(added ? `Added ${added} calendar(s)` : "Nothing selected");

			return true;
		});
	}

	/* ------------------------------------------------------------- shared */

	/** Cancel plus a primary action. The action returns whether to close. */
	private footer(cta: string, action: () => Promise<boolean>): void {
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Back").onClick(() => {
					this.step = "choose";
					this.render();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(cta)
					.setCta()
					.onClick(async () => {
						if (await action()) {
							this.close();
							this.onDone();
						}
					}),
			);
	}
}
