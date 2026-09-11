import { ItemView, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { ConfigError, countPanels, parseDashboard } from "./layout-tree";
import { readDays } from "./data";
import { CalendarFiller, DEFAULT_GAP, renderNode } from "./layout";
import { CalendarService } from "./calendar";
import { CalendarPanel, UpcomingPanel } from "./panels";
import { fillCalendar, fillMonth, monthWindow } from "./render";
import { EventModal, NameModal } from "./modal";
import { VisualEditor } from "./editor";
import { serializeDashboard } from "./serialize";
import { CalendarSource, DashboardSettings, activeDashboard, makeDashboard, uniqueName } from "./store";

export const VIEW_TYPE_DASHBOARD = "ultimate-dashboard-view";

/** Obsidian's settings window, attached to app at runtime but not typed. */
interface SettingsWindow {
	open(): void;
	openTabById(id: string): void;
}

type AppWithSettings = DashboardView["app"] & { setting?: SettingsWindow };

/** What the view needs from the plugin, kept narrow so it stays testable. */
export interface ViewHost {
	settings: DashboardSettings;
	pluginId: string;
	calendars: CalendarService;
	saveSettings(): Promise<void>;
	refreshViews(): void;
	invalidateCalendars(): void;
}

export class DashboardView extends ItemView {
	/** Per-tab, deliberately not persisted: reopening starts on the chart side. */
	private mode: "dashboard" | "edit" = "dashboard";
	/** Which editor the edit mode shows. */
	private editorTab: "visual" | "yaml" = "visual";

	constructor(
		leaf: WorkspaceLeaf,
		private host: ViewHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		const current = activeDashboard(this.host.settings);

		return current ? `Dashboard: ${current.name}` : "Ultimate Dashboard";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		// Skip the redraw while editing: it would rebuild the textarea and drop
		// the cursor mid-keystroke.
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (this.mode === "dashboard") this.render();
			}),
		);
		this.render();
	}

	render(): void {
		const host = this.contentEl;
		host.empty();
		host.addClass("udash-view");

		this.renderHeader(host);

		const root = host.createDiv({ cls: "lifedash" });
		const current = activeDashboard(this.host.settings);

		if (!current) {
			this.error(root, "No dashboards yet. Use the + button to make one.");

			return;
		}

		if (this.mode === "edit") {
			this.renderEditor(root, current);

			return;
		}

		let config;

		try {
			config = parseDashboard(current.config);
		} catch (e) {
			this.error(root, e instanceof ConfigError ? e.message : String(e));

			return;
		}

		const days = readDays(this.app, config.folder);

		if (days.length === 0) {
			this.error(
				root,
				`No notes named YYYY-MM-DD found in "${config.folder}". Check the \`folder\` setting.`,
			);

			return;
		}

		renderNode(
			root,
			config.root,
			days,
			DEFAULT_GAP,
			(target, message) => this.error(target, message),
			this.makeCalendarFiller(),
		);
	}

	/** A switcher and a new-dashboard button. Hidden entirely when there is nothing to switch. */
	private renderHeader(host: HTMLElement): void {
		const { settings } = this.host;
		const bar = host.createDiv({ cls: "udash-bar" });

		if (settings.dashboards.length > 1) {
			const select = bar.createEl("select", { cls: "udash-switcher dropdown" });

			for (const d of settings.dashboards) {
				const opt = select.createEl("option", { text: d.name, value: d.id });

				if (d.id === settings.activeId) opt.selected = true;
			}

			select.addEventListener("change", async () => {
				settings.activeId = select.value;
				this.mode = "dashboard";
				await this.host.saveSettings();
				this.host.refreshViews();
			});
		} else {
			const only = settings.dashboards[0];
			bar.createSpan({ cls: "udash-bar-title", text: only ? only.name : "Ultimate Dashboard" });
		}

		const spacer = bar.createDiv({ cls: "udash-bar-spacer" });
		spacer.setAttr("aria-hidden", "true");

		const toggle = bar.createEl("button", { cls: "udash-bar-button" });
		setIcon(toggle, this.mode === "edit" ? "eye" : "pencil");
		setTooltip(toggle, this.mode === "edit" ? "Back to the dashboard" : "Edit this layout");
		toggle.toggleClass("is-active", this.mode === "edit");
		toggle.addEventListener("click", () => {
			this.mode = this.mode === "edit" ? "dashboard" : "edit";
			this.render();
		});

		const add = bar.createEl("button", { cls: "udash-bar-button" });
		setIcon(add, "plus");
		setTooltip(add, "New dashboard");
		add.addEventListener("click", () => this.promptNew());

		const cog = bar.createEl("button", { cls: "udash-bar-button" });

		setIcon(cog, "settings");
		setTooltip(cog, "Ultimate Dashboard settings");
		cog.addEventListener("click", () => this.openSettings());
	}

	/** Loads feeds in the background and fills each calendar panel when they land. */
	private makeCalendarFiller(): CalendarFiller | undefined {
		const sources = this.host.settings.calendars;

		if (sources.length === 0) return undefined;

		return (shell: HTMLElement, panel: CalendarPanel | UpcomingPanel) => {
			const wanted = panel.calendars
				? sources.filter((s) => panel.calendars!.includes(s.name))
				: sources;

			if (wanted.length === 0) {
				const missing = `No calendar named ${(panel.calendars ?? []).join(", ")}`;

				if (panel.type === "calendar") {
					fillMonth(shell, panel, monthWindow(panel).first, [], [missing]);
				} else {
					fillCalendar(shell, [], [missing], false);
				}

				return;
			}

			if (panel.type === "calendar") {
				const { first, from, to } = monthWindow(panel);

				void this.host.calendars.events(wanted, from, to).then(({ events, errors }) => {
					// the view may have re-rendered while the fetch was in flight
					if (!shell.isConnected) return;
					fillMonth(shell, panel, first, events, errors);
				});

				return;
			}

			this.addEventButton(shell, wanted);

			const from = new Date();

			if (!panel.past) from.setHours(0, 0, 0, 0);
			const to = new Date(from.getTime() + (panel.ahead ?? 14) * 86400000);

			void this.host.calendars.events(wanted, from, to).then(({ events, errors }) => {
				if (!shell.isConnected) return;
				const now = new Date();

				const visible = events
					.filter((e) => (panel.past ? true : e.end >= now))
					.slice(0, panel.limit ?? 25);

				fillCalendar(shell, visible, errors, wanted.length > 1);
			});
		};
	}

	/** Only Google calendars marked writable can take a new event. */
	private addEventButton(shell: HTMLElement, sources: CalendarSource[]): void {
		const targets: { id: string; accountId: string; name: string }[] = [];

		for (const source of sources) {
			// narrowing in the loop avoids asserting the optional fields are present
			if (source.type !== "google" || !source.writable) continue;

			if (!source.calendarId || !source.accountId) continue;
			targets.push({ id: source.calendarId, accountId: source.accountId, name: source.name });
		}

		if (targets.length === 0) return;
		const actions = shell.querySelector(".udash-calendar-actions");

		if (!actions) return;
		const button = actions.createEl("button", { cls: "udash-bar-button", text: "+" });

		setTooltip(button, "New event");
		button.addEventListener("click", () => {
			new EventModal(this.app, targets, async (accountId, calendarId, event) => {
				await this.host.calendars.create(accountId, calendarId, event);
				this.render();
			}).open();
		});
	}

	/** Edit mode: a visual canvas, or the raw YAML behind it. */
	private renderEditor(root: HTMLElement, current: { config: string }): void {
		const tabs = root.createDiv({ cls: "udash-editor-tabs" });

		for (const tab of ["visual", "yaml"] as const) {
			const button = tabs.createEl("button", {
				cls: "udash-editor-tab",
				text: tab === "visual" ? "Visual" : "YAML",
			});

			button.toggleClass("is-active", this.editorTab === tab);
			button.addEventListener("click", () => {
				this.editorTab = tab;
				this.render();
			});
		}

		if (this.editorTab === "yaml") {
			this.renderYamlEditor(root, current);

			return;
		}

		let parsed;

		try {
			parsed = parseDashboard(current.config);
		} catch (e) {
			this.error(
				root,
				`${e instanceof ConfigError ? e.message : String(e)} \u2014 fix it in the YAML tab.`,
			);

			return;
		}

		const editor = new VisualEditor(
			this.app,
			parsed,
			{
				properties: this.knownProperties(parsed.folder),
				calendars: this.host.settings.calendars.map((c) => c.name),
			},
			(next) => {
				current.config = serializeDashboard(next);
				void this.host.saveSettings();
				this.render();
			},
		);

		editor.render(root.createDiv());
	}

	/** Frontmatter keys actually present, to offer while configuring a panel. */
	private knownProperties(folder: string): string[] {
		const seen = new Set<string>();

		for (const day of readDays(this.app, folder)) {
			for (const key of Object.keys(day.props)) seen.add(key);
		}

		seen.delete("created");

		return [...seen].sort();
	}

	private renderYamlEditor(root: HTMLElement, current: { config: string }): void {
		const editor = root.createEl("textarea", { cls: "udash-config-editor" });
		editor.value = current.config;
		editor.spellcheck = false;

		const status = root.createDiv({ cls: "udash-config-status" });

		const validate = (source: string): boolean => {
			status.empty();

			try {
				const parsed = parseDashboard(source);
				const n = countPanels(parsed.root);
				status.removeClass("is-error");
				status.addClass("is-valid");
				status.setText(`Valid: ${n} ${n === 1 ? "panel" : "panels"}.`);

				return true;
			} catch (e) {
				status.removeClass("is-valid");
				status.addClass("is-error");
				status.setText(e instanceof ConfigError ? e.message : String(e));

				return false;
			}
		};

		validate(editor.value);
		editor.addEventListener("input", async () => {
			current.config = editor.value;
			await this.host.saveSettings();
			validate(editor.value);
		});

		window.setTimeout(() => editor.focus(), 0);
	}

	/**
	 * Opens Obsidian's settings straight on this plugin's tab. `app.setting` is
	 * how every plugin does this; it is real but absent from the typings.
	 */
	private openSettings(): void {
		// SAFETY: Obsidian attaches the settings window to app at runtime; the
		// guard below covers a future version moving it.
		const setting = (this.app as AppWithSettings).setting;

		if (!setting) return;
		setting.open();
		setting.openTabById(this.host.pluginId);
	}

	private promptNew(): void {
		new NameModal(
			this.app,
			{ title: "New dashboard", cta: "Create" },
			async (name) => {
				const { settings } = this.host;
				const created = makeDashboard(uniqueName(settings, name));
				settings.dashboards.push(created);
				settings.activeId = created.id;
				this.mode = "edit";
				await this.host.saveSettings();
				this.host.refreshViews();
			},
		).open();
	}

	private error(el: HTMLElement, message: string): void {
		const box = el.createDiv({ cls: "udash-error" });
		box.createSpan({ cls: "udash-error-tag", text: "dashboard" });
		box.createSpan({ text: message });
	}
}
