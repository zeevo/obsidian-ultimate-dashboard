import * as z from "zod/mini";

const Saved = z.record(z.string(), z.unknown());

const Offset = z.number();

/**
 * How far each embedded note is scrolled, by path, kept across restarts.
 *
 * It lives in the vault's local storage rather than data.json: a scroll
 * position belongs to this device, and data.json is synced, so writing it on
 * every scroll would churn the sync for nothing.
 */
export class ScrollMemory {
	private offsets: Map<string, number>;

	constructor(
		stored: unknown,
		private save: (offsets: Record<string, number>) => void,
	) {
		const saved = Saved.safeParse(stored);
		const entries = saved.success ? Object.entries(saved.data) : [];

		// one bad entry costs only that note its place, not every note
		this.offsets = new Map();

		for (const [path, value] of entries) {
			const top = Offset.safeParse(value);

			if (top.success) this.offsets.set(path, top.data);
		}
	}

	get(path: string): number | undefined {
		return this.offsets.get(path);
	}

	set(path: string, top: number): void {
		this.offsets.set(path, top);
		this.save(Object.fromEntries(this.offsets));
	}
}
