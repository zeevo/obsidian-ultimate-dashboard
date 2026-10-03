import { DayRecord, num, truthy } from "../data";
import { shiftDate, today } from "../dates";
import { WidgetKind, assertNever } from "../kinds";
import { FieldKind } from "../schema";
import { AGGS, Agg, StatWidget, WidgetSpec } from "./types";

function aggregate(days: DayRecord[], widget: StatWidget): number | null {
	const from = widget.back ? shiftDate(today(), -(widget.back - 1)) : null;
	const scope = from ? days.filter((d) => d.date >= from) : days;
	const agg = widget.agg ?? Agg.Latest;

	if (agg === Agg.Count) return scope.filter((d) => truthy(d, widget.property)).length;

	const vals: number[] = [];

	for (const day of scope) {
		const v = num(day, widget.property);

		if (v !== null) vals.push(v);
	}

	if (vals.length === 0) return null;

	switch (agg) {
		case Agg.Latest:
			return vals[vals.length - 1];
		case Agg.Sum:
			return vals.reduce((a, b) => a + b, 0);
		case Agg.Mean:
			return vals.reduce((a, b) => a + b, 0) / vals.length;
		case Agg.Delta:
			return vals[vals.length - 1] - vals[0];
		default:
			return assertNever(agg, "aggregate");
	}
}

/** One number. Arrange several with rows and columns. */
export function renderStat(el: HTMLElement, days: DayRecord[], widget: StatWidget): void {
	const agg = widget.agg ?? Agg.Latest;
	const value = aggregate(days, widget);
	const precision = widget.precision ?? (agg === Agg.Count ? 0 : 1);
	const card = el.createDiv({ cls: "udash-tile" });

	card.createDiv({ cls: "udash-tile-label", text: stat.title(widget) });

	const valueEl = card.createDiv({ cls: "udash-tile-value" });

	if (value === null) {
		valueEl.setText("\u2014");
	} else {
		const shown =
			agg === Agg.Delta && value > 0 ? "+" + value.toFixed(precision) : value.toFixed(precision);

		valueEl.setText(shown);

		if (widget.target !== undefined) {
			valueEl.createSpan({ cls: "udash-tile-target", text: ` / ${widget.target}` });
		}

		if (widget.unit) valueEl.createSpan({ cls: "udash-tile-unit", text: ` ${widget.unit}` });
	}

	card.createDiv({ cls: "udash-tile-sub", text: widget.back ? `last ${widget.back} days` : agg });
}

export const stat: WidgetSpec<StatWidget> = {
	type: WidgetKind.Stat,
	label: "Stat",
	hint: "One number",
	fields: [
		{ key: "label", kind: FieldKind.Text, label: "Caption" },
		{ key: "property", kind: FieldKind.Property, label: "Property", required: true },
		{
			key: "agg",
			kind: FieldKind.Choice,
			label: "Aggregate",
			choices: AGGS.map((a) => ({ value: a, label: a })),
		},
		{ key: "back", kind: FieldKind.Number, label: "Days back" },
		{ key: "target", kind: FieldKind.Number, label: "Target" },
		{ key: "unit", kind: FieldKind.Text, label: "Unit", placeholder: "lb" },
		{ key: "precision", kind: FieldKind.Number, label: "Decimal places", min: 0 },
	],
	blank: () => ({ type: WidgetKind.Stat, property: "" }),
	title: (w) => w.label || w.property || "Stat",
	summary: (p) => (p.property ? `${p.agg ?? Agg.Latest} of ${p.property}` : "not configured"),
	render: (el, widget, ctx) => renderStat(el, ctx.days, widget),
};
