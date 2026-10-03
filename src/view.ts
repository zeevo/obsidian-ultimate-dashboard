import { Component, ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { ConfigError, DashboardConfig, countWidgets, parseDashboard } from "./layout-tree";
import { readDays } from "./data";
import { renderNode } from "./layout";
import { CalendarService } from "./calendar";
import { WeatherService } from "./weather";
import { EventTarget, WidgetHost } from "./widgets/host";
import { connect } from "./google";
import { EventDetailsModal, EventModal, NameModal } from "./modal";
import { LayoutEditor } from "./editor";
import { serializeDashboard } from "./serialize";
import { DashboardSettings, activeDashboard, findAccount, makeDashboard, uniqueName } from "./store";

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
	weather: WeatherService;
	saveSettings(): Promise<void>;
	refreshViews(): void;
	invalidateCalendars(): void;
}

export class DashboardView extends ItemView {
	/** Per-tab, deliberately not persisted: reopening starts on the chart side. */
	private mode: "dashboard" | "edit" = "dashboard";
	/** Which editor the edit mode shows. */
	private editorTab: "visual" | "yaml" = "visual";
	/** Lifecycle owners widgets took for this draw (embedded notes, clocks), dropped on redraw. */
	private embeds: Component[] = [];
	/**
	 * How far each embedded note is scrolled, by path. The whole view is rebuilt
	 * whenever any note in the vault changes, so without this a tile you had
	 * scrolled would jump back to the top as you typed elsewhere.
	 */
	private scrolled = new Map<string, number>();
	/** The layout editor for the current draw, while in edit mode. */
	private editor: LayoutEditor | null = null;
	/**
	 * How many months each full calendar has been paged from its configured
	 * month, by dashboard and position. Per tab and never saved, so a redraw
	 * keeps the month you browsed to but reopening starts over.
	 */
	private monthOffsets = new Map<string, number>();

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

		return current ? `DashboardConfig: ${current.name}` : "Ultimate DashboardConfig";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		// Skip the redraw in the YAML editor, where it would rebuild the textarea
		// and drop the cursor mid-keystroke, and mid-drag, where it would drop
		// the thing being dragged.
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (this.mode === "edit" && (this.editorTab === "yaml" || this.editor?.isDragging)) return;
				this.render();
			}),
		);
		this.render();
	}

	render(): void {
		const host = this.contentEl;
		// emptying the view collapses it for a moment, which would scroll it back
		// to the top on every edit and every redraw
		const scrollTop = host.scrollTop;

		this.draw(host);
		host.scrollTop = scrollTop;
	}

	private draw(host: HTMLElement): void {
		// the markdown children own event handlers and child components of their
		// own; emptying the DOM under them is not enough to release those
		for (const embed of this.embeds) this.removeChild(embed);
		this.embeds = [];
		this.editor = null;

		host.empty();
		host.addClass("udash-view");

		this.renderHeader(host);

		const current = activeDashboard(this.host.settings);
		const toolbar = current && this.mode === "edit" ? this.renderToolbar(host) : null;
		const root = host.createDiv({ cls: "lifedash" });

		if (!current) {
			this.error(root, "No dashboards yet. Use the + button to make one.");

			return;
		}

		if (this.mode === "edit" && this.editorTab === "yaml") {
			this.renderYamlEditor(root, current);

			return;
		}

		let config;

		try {
			config = parseDashboard(current.config);
		} catch (e) {
			const message = e instanceof ConfigError ? e.message : String(e);

			this.error(root, this.mode === "edit" ? `${message}. Fix it in the YAML tab.` : message);

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

		if (toolbar) {
			this.editor = this.makeEditor(current, config);
			this.editor.attach(root);
			this.editor.renderPalette(toolbar.createDiv({ cls: "udash-palette" }));
		}

		renderNode(
			root,
			config.root,
			{ days, error: (target, message) => this.error(target, message), host: this.widgetHost() },
			this.editor?.decorate,
		);
	}

	/**
	 * What widgets may use from this view for one draw. Built per draw so month
	 * keys count from zero each time and owners are released by the next one.
	 */
	private widgetHost(): WidgetHost {
		const { settings, calendars, weather } = this.host;
		const dashboardId = activeDashboard(settings)?.id ?? "";
		let monthIndex = 0;

		return {
			own: () => {
				const owner = new Component();

				this.addChild(owner);
				this.embeds.push(owner);

				return owner;
			},
			readNote: async (path) => {
				const file = this.app.metadataCache.getFirstLinkpathDest(path, "");

				return file ? { path: file.path, text: await this.app.vault.cachedRead(file) } : null;
			},
			renderMarkdown: (markdown, el, sourcePath, owner) =>
				MarkdownRenderer.render(this.app, markdown, el, sourcePath, owner),
			scrolled: this.scrolled,
			weather: (query) => weather.weather(query),
			sources: settings.calendars,
			events: (sources, from, to) => calendars.events(sources, from, to),
			createEvent: (targets, on) => this.createEvent(targets, on),
			showEvent: (event) => new EventDetailsModal(this.app, event).open(),
			accountEmail: (accountId) => findAccount(settings.google, accountId)?.email,
			reconnectGoogle: (accountId) => void this.reconnectGoogle(accountId),
			monthOffsets: this.monthOffsets,
			nextMonthKey: () => `${dashboardId}:${monthIndex++}`,
		};
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
			bar.createSpan({ cls: "udash-bar-title", text: only ? only.name : "Ultimate DashboardConfig" });
		}

		const spacer = bar.createDiv({ cls: "udash-bar-spacer" });
		spacer.setAttr("aria-hidden", "true");

		const toggle = bar.createEl("button", { cls: "udash-bar-button" });
		setIcon(toggle, this.mode === "edit" ? "check" : "pencil");
		setTooltip(toggle, this.mode === "edit" ? "Done editing" : "Edit this layout");
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
		setTooltip(cog, "Ultimate DashboardConfig settings");
		cog.addEventListener("click", () => this.openSettings());
	}

	/** Signs a Google account in again, keeping its id so its calendars stay attached. */
	private async reconnectGoogle(accountId: string): Promise<void> {
		const g = this.host.settings.google;
		const account = findAccount(g, accountId);

		if (!account) return;

		try {
			Object.assign(account, await connect(g, g.port));
			await this.host.saveSettings();
			this.host.invalidateCalendars();
		} catch (e) {
			// SAFETY: connect() throws Errors; a non-Error still stringifies.
			new Notice(`Google sign in failed: ${(e as Error).message}`, 8000);
		}
	}

	/** Opens the new-event form, optionally on a chosen day. */
	private createEvent(targets: EventTarget[], on?: Date): void {
		new EventModal(
			this.app,
			targets,
			async (accountId, calendarId, event) => {
				await this.host.calendars.create(accountId, calendarId, event);
				this.render();
			},
			on,
		).open();
	}

	/**
	 * The strip above the dashboard in edit mode: the palette to drag new pieces
	 * from, and a switch to the raw YAML behind the layout.
	 */
	private renderToolbar(host: HTMLElement): HTMLElement {
		const toolbar = host.createDiv({ cls: "udash-edit-toolbar" });
		const tabs = toolbar.createDiv({ cls: "udash-editor-tabs" });

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

		return toolbar;
	}

	private makeEditor(current: { config: string }, config: DashboardConfig): LayoutEditor {
		return new LayoutEditor(
			this.app,
			config,
			{
				properties: this.knownProperties(config.folder),
				calendars: this.host.settings.calendars.map((c) => c.name),
				notes: this.app.vault.getMarkdownFiles().map((f) => f.path).sort(),
			},
			(next) => {
				current.config = serializeDashboard(next);
				void this.host.saveSettings();
				this.render();
			},
			() => this.render(),
		);
	}

	/** Frontmatter keys actually present, to offer while configuring a widget. */
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
				const n = countWidgets(parsed.root);
				status.removeClass("is-error");
				status.addClass("is-valid");
				status.setText(`Valid: ${n} ${n === 1 ? "widget" : "widgets"}.`);

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
