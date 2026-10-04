import { Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarService } from "./calendar";
import { WeatherService } from "./weather";
import { DashboardSettings, addDashboard, defaultSettings, migrate } from "./store";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./view";
import { NameModal } from "./modal";
import { ScrollMemory } from "./scroll-memory";

/** Where embedded notes' scroll offsets are kept, in the vault's local storage. */
const SCROLL_KEY = "ultimate-dashboard-scroll";

export default class UltimateDashboardPlugin extends Plugin {
	settings: DashboardSettings = defaultSettings();
	calendars = new CalendarService();
	weather = new WeatherService();
	scrolled = new ScrollMemory(
		this.app.loadLocalStorage(SCROLL_KEY),
		(offsets) => this.app.saveLocalStorage(SCROLL_KEY, offsets),
	);

	async onload(): Promise<void> {
		await this.loadSettings();

		// The layout is already up when a plugin is enabled by hand or reloaded,
		// which is not a startup. Opening the dashboard then would yank you out of
		// whatever tab you were reading, so only a cold start counts.
		const coldStart = !this.app.workspace.layoutReady;

		this.registerView(
			VIEW_TYPE_DASHBOARD,
			(leaf: WorkspaceLeaf) => new DashboardView(leaf, this),
		);

		this.addCommand({
			id: "open",
			name: "Open dashboard",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "refresh-calendars",
			name: "Refresh calendars",
			callback: () => {
				this.calendars.invalidate();
				this.refreshViews();
			},
		});

		this.addCommand({
			id: "new",
			name: "New dashboard",
			callback: () => this.promptNewDashboard(),
		});

		this.addRibbonIcon("layout-dashboard", "Ultimate Dashboard", () => this.activateView());

		this.calendars.useGoogle(() => ({
			config: this.settings.google,
			saveTokens: async (accountId, updated) => {
				const accounts = this.settings.google.accounts;
				const i = accounts.findIndex((a) => a.id === accountId);

				if (i >= 0) accounts[i] = updated;
				await this.saveSettings();
			},
		}));

		this.app.workspace.onLayoutReady(() => {
			if (coldStart) void this.openStartupDashboard();
		});
	}

	/**
	 * Opens the dashboard chosen in settings, if one is. An existing tab is
	 * focused rather than duplicated, so a restored workspace stays as it was.
	 */
	private async openStartupDashboard(): Promise<void> {
		const { startupId } = this.settings;

		if (!startupId || !this.settings.dashboards.some((d) => d.id === startupId)) return;

		if (this.settings.activeId !== startupId) {
			this.settings.activeId = startupId;
			await this.saveSettings();
		}

		await this.activateView();
		this.refreshViews();
	}

	/** Focus the dashboard tab, opening one only if none is already there. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);

		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);

			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Redraw every open dashboard tab, after a settings change. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			const view = leaf.view;

			if (view instanceof DashboardView) {
				view.render();
				// keep the tab title in step with the active dashboard's name
				leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: false });
			}
		}
	}

	/** Prompt for a name, create it, switch to it, and show it. */
	promptNewDashboard(): void {
		new NameModal(this.app, { title: "New dashboard", cta: "Create" }, async (name) => {
			addDashboard(this.settings, name);
			await this.saveSettings();
			await this.activateView();
			this.refreshViews();
		}).open();
	}

	async loadSettings(): Promise<void> {
		this.settings = migrate(await this.loadData());
	}

	invalidateCalendars(): void {
		this.calendars.invalidate();
		this.refreshViews();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

}
