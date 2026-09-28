/* Stands in for the `obsidian` module when running the harness under node.
   Only the surface the plugin actually touches is implemented. */
import { load } from "js-yaml";

export function parseYaml(source: string): unknown {
	return load(source);
}

export class Plugin {
	app: unknown;
	registerMarkdownCodeBlockProcessor(): void {}
	registerEvent(): void {}
}

export type App = {
	vault: { getMarkdownFiles(): { path: string; basename: string }[] };
	metadataCache: {
		getFileCache(f: { path: string }): { frontmatter?: Record<string, unknown> } | null;
		on(): unknown;
	};
	workspace: { trigger(): void };
};

export type MarkdownPostProcessorContext = unknown;

export class Component {
	registerEvent(): void {}
}

export class View extends Component {
	contentEl: unknown = null;
	constructor(public leaf: unknown) {
		super();
	}
}

export class ItemView extends View {}

export type WorkspaceLeaf = unknown;

export class PluginSettingTab {
	containerEl: unknown = null;
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
}

export class Setting {
	constructor(public containerEl: unknown) {}
	setName(): this { return this; }
	setDesc(): this { return this; }
	addTextArea(): this { return this; }
	addExtraButton(): this { return this; }
}

/** Set by a check that needs a canned network answer; unset, requests throw. */
export const network: { answer?: (req: { url: string; body?: string }) => unknown } = {};

export async function requestUrl(req: { url: string; body?: string }): Promise<unknown> {
	if (!network.answer) throw new Error("requestUrl is not available in the harness");

	return network.answer(req);
}

export const Platform = { isDesktopApp: true, isMobile: false };

export class Notice {
	constructor(public message: string) {}
}

export function setIcon(): void {}

export function setTooltip(): void {}

export class Modal {
	contentEl: unknown = null;
	constructor(public app: unknown) {}
	open(): void {}
	close(): void {}
}
