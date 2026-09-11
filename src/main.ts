import { Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarService } from "./calendar";
import { DashboardSettingTab } from "./settings";
import { DashboardSettings, defaultSettings, makeDashboard, migrate, uniqueName } from "./store";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./view";
import { NameModal } from "./modal";

export default class UltimateDashboardPlugin extends Plugin {
	settings: DashboardSettings = defaultSettings();
	calendars = new CalendarService();

	get pluginId(): string {
		return this.manifest.id;
	}

	async onload(): Promise<void> {
		await this.loadSettings();

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

		this.addSettingTab(new DashboardSettingTab(this.app, this));
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
			const created = makeDashboard(uniqueName(this.settings, name));
			this.settings.dashboards.push(created);
			this.settings.activeId = created.id;
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
