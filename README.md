# Ultimate Dashboard

An Obsidian plugin that renders stat tiles, year heatmaps and rolling-average
line charts from daily note frontmatter, driven by a declarative YAML layout.

No runtime dependencies. It reads frontmatter through Obsidian's own
`metadataCache` and draws every widget itself, so it needs neither Dataview nor
Heatmap Calendar.

## Using it

Run **Ultimate Dashboard: Open dashboard** from the command palette, or click the
ribbon icon. Running it again focuses the existing tab rather than opening a
second one.

### Editing

The pencil opens edit mode, which has two tabs.

**Visual** is a palette and a canvas. Drag a widget type onto a drop zone to add
it; drag one already on the canvas to move it anywhere, including into a
divider. Dropping a type that needs settings, like a heatmap with no property
yet, opens its configuration straight away.

Each card carries a pencil to reconfigure and a bin to remove. Dropping is
handled per container rather than per gap: the whole container is a target, and
a line shows which side of a card the widget will land on.

The palette's **dividers** are containers: *Columns* lays its children out side
by side, *Rows* stacks them. Drop widgets inside one to segment the dashboard,
and nest them for more involved layouts.

Every container, the outermost one included, has a pencil. Its **Layout**
setting switches between rows and columns, so nothing about the shape is fixed: a new dashboard is a plain stack, and you build any arrangement by adding
dividers rather than configuring a preset. Only the outermost container cannot
be moved or deleted.

**YAML** is the same document as text. The visual editor writes through the
serialiser, so the two are views of one thing and either can pick up where the
other left off.

The tab has a small bar across the top:

| Control | Does |
|---------|------|
| dropdown | Switches dashboards. Only shown once you have more than one |
| pencil | Toggles between the rendered dashboard and its YAML |
| plus | Creates a dashboard, asking for a name first |

Edit mode validates as you type and saves continuously; click the eye to go
back. The same editor, plus rename, duplicate and delete, lives in Settings →
Community plugins → Ultimate Dashboard.

Layouts are stored in the plugin's `data.json`, not in your notes.

## Adding a widget type

Widgets are declared once, in `src/widgets.ts`:

```ts
const heatmap: WidgetSpec<HeatmapWidget> = {
  type: WidgetKind.Heatmap,
  label: "Heatmap",
  hint: "A year of activity",
  fields: [
    { key: "property", kind: FieldKind.Property, label: "Property", required: true },
    { key: "color",    kind: FieldKind.Colour,   label: "Color" },
    ...RANGE_FIELDS,
  ],
  summary: (p) => p.property || "not configured",
  validate: validateRange,
};
```

Parsing, validation, serialising, the configuration form and the editor palette
are all derived from that declaration. `fields` keys are typed against the widget
interface, so a rename is a compile error rather than a field that silently
stops loading. Cross-field rules that a per-field schema cannot see go in
`validate`.

## Layout YAML

```yaml
folder: Daily
widgets:
  - type: stats
    tiles:
      - { label: Weight, property: weight, agg: latest, unit: lb }
      - { label: 7 day average, property: weight, agg: mean, days: 7, unit: lb }
      - { label: Lifts this week, property: lift, agg: count, days: 7, target: 3 }

  - type: line
    title: Weight
    property: weight
    rolling: 7
    unit: lb

  - type: heatmap
    title: Cardio
    property: cardio
    intensity: miles
    color: "#3b82f6"
```

Notes are picked up when they live in `folder` and are named `YYYY-MM-DD`.

## Options

### Top level

| Key | Default | Meaning |
|-----|---------|---------|
| `folder` | `Daily` | Folder holding the dated notes |
| `gap` | `20` | Space between widgets, in pixels |
| `widgets` | required | List of widgets |

### Layout

Widgets are leaves of a layout tree. Three container types hold `children`:

| Container | Behaviour |
|-----------|-----------|
| `column` | stacks its children vertically |
| `row` | lays them side by side, wrapping by default |

There is no grid type: two columns is a `row` with two children, and anything
more elaborate is those two nesting.

```yaml
layout:
  type: column
  gap: 22
  children:
    - type: stats
      tiles: [...]

    - type: row
      children:
        - { type: line, property: weight, rolling: 7, flex: 2 }
        - { type: heatmap, property: lift, flex: 1 }

    - type: row
      children:
        - { type: heatmap, property: cardio, intensity: miles }
        - { type: heatmap, property: vitamins }
        - { type: heatmap, property: read }
```

Containers nest to 8 levels. The root must be a container, and a widget cannot
take `children`: wrap widgets in a `row` or `column` instead.

**Container options**

| Key | Applies to | Meaning |
|-----|-----------|---------|
| `gap` | both | Space between children, in px. Inherited when unset |
| `wrap` | row | `false` to keep children on one line |

**Child sizing**

| Key | Meaning |
|-----|---------|
| `flex` | Growth factor, like CSS `flex-grow`. Two children at `flex: 1` split the row evenly |

| Key | Valid inside | Meaning |
|-----|-------------|---------|
| `flex` | row, column | Growth factor, like CSS `flex-grow` |

`span`, `columns` and `minWidth` were removed along with the grid type; the
parser rejects them with a message pointing at the replacement.

Below 700px every row becomes a column, so a deeply nested dashboard stays
readable in a split pane or on a phone.


### Ranges

Both `heatmap` and `line` accept a date window. Pick at most one option; setting
two is an error rather than a silent precedence rule.

| Key | Window |
|-----|--------|
| `year: 2025` | That whole calendar year |
| `months: 6` | The last six months, ending today |
| `days: 90` | The last 90 days, ending today |
| `from` / `to` | Explicit and inclusive. `from` alone runs to today; `to` alone runs from your first note |

```yaml
- type: heatmap
  property: lift
  months: 6

- type: line
  property: weight
  rolling: 7
  months: 6
```

The default differs by widget, because the widgets differ: a heatmap must draw a
concrete calendar so it falls back to the current year, while a line chart has
no such constraint and plots everything it has.

Heatmap month labels follow the window, including a partial first month, and
gain a two digit year when the window crosses one.

### `type: upcoming`

An agenda of what is coming up, grouped by day.

| Key | Meaning |
|-----|---------|
| `title` | Heading. Defaults to "Upcoming" |
| `calendars` | Names to include. Omit for every configured calendar |
| `days` | How far ahead to look. Default 14 |
| `limit` | Most events to list. Default 25 |
| `past` | `true` to include events already finished today |

```yaml
- type: upcoming
  calendars: [Holidays]
  days: 21
  limit: 12
```

A `+` appears in the header when any of its calendars can take new events.

### `type: calendar`

A month grid, like a wall calendar. Always six rows, so the widget does not
change height from month to month.

| Key | Meaning |
|-----|---------|
| `title` | Heading. Defaults to the month and year |
| `calendars` | Names to include. Omit for every configured calendar |
| `month` | The month to show, as `2026-09`. Defaults to the current month |
| `maxPerDay` | Events per day before a "+N more" line. Default 3 |
| `weekStart` | `0` for Sunday, `1` for Monday. Default 0 |

```yaml
- type: calendar
  month: 2026-09
  weekStart: 1
  maxPerDay: 4
```

An event spanning several days appears in every cell it covers. Both widgets
refer to calendars by name, from the one pool configured in settings.

### Creating events

A widget showing at least one writable Google calendar gets a `+` in its header.
On a month grid you can also **click any day** to open the form with that date
already filled in; days are only clickable when a writable calendar is in scope,
so a read-only dashboard stays inert.

### Calendars

Two kinds of source, both configured under Settings → Community plugins → Life
Dashboard and stored in `data.json` under `calendars`.

**ICS, read only.** A name, a feed URL and a colour. Any published calendar
works, including Google's: Google Calendar → Settings → Settings for my
calendars → pick one → Integrate calendar → **Secret address in iCal format**.
Treat that URL as a password. No account, no auth, works on mobile.

**Google, read and write.** Needed to create events. One OAuth client you
create, through which you can connect **any number of accounts**: press Add
account again for a second one. Calendars from every account and every ICS feed
land in a single pool, and a widget picks from it by name, so one dashboard can
mix work and personal calendars while another shows neither.

Setting up the OAuth client:

1. Google Cloud Console → new project
2. Enable the **Google Calendar API**
3. OAuth consent screen → add yourself as a **test user**, or access lapses
   after seven days
4. Credentials → OAuth client ID → type **Desktop app**
5. Add the redirect URI the settings tab shows you, exactly
6. Paste the client ID and secret, press **Connect**, then **Load calendars**

Connecting opens your browser and catches the redirect on a loopback listener,
so no credential leaves the machine. PKCE is used, and tokens are refreshed a
minute before they lapse. Desktop only: the listener needs node's http module.

CalDAV is deliberately not supported. Google disabled Basic Auth for it in March
2025 and answers 401 to anything else, and once an OAuth token exists the REST
API is a better tool than XML over the same auth.

Feeds are fetched with Obsidian's `requestUrl` rather than `fetch`, because the
renderer enforces CORS and calendar hosts do not send the headers that would
allow it, and cached for ten minutes. **Ultimate Dashboard: Refresh calendars**
clears the cache.

The form asks for a title, date, times or all-day, and location, then writes
straight to Google. ICS widgets have no button: the format has no write verb.

The ICS reader handles folded lines, escaped text, all-day and timed events,
`EXDATE`, and `RRULE` for daily, weekly (including `BYDAY`), monthly and yearly
rules with `INTERVAL`, `COUNT` and `UNTIL`. It is not a complete RFC 5545
implementation: a `TZID` is read as local time, since resolving one properly
needs a timezone database.

### Removed


`widgets`, `grid`, `span`, `columns` and `minWidth` are gone. A layout is one
tree of rows and columns, sized with `flex`. The parser rejects each removed key
with a message naming its replacement.

On a time range, `days` was ambiguous: it meant a trailing window on a chart and
a forward window on an agenda. It is now `back` and `ahead`.

### `type: stat`

One number. Arrange several with rows and columns, like any other widget.

| Key | Meaning |
|-----|---------|
| `property` | Frontmatter key. Required |
| `label` | Caption. Defaults to the property name |
| `agg` | `latest`, `mean`, `sum`, `count`, `delta`. Default `latest` |
| `back` | Rolling window in days; omit for all history |
| `target` | Renders as `value / target` |
| `unit` | Suffix |
| `precision` | Decimal places (default 1, or 0 for `count`) |

```yaml
- type: row
  children:
    - { type: stat, label: Weight, property: weight, unit: lb }
    - { type: stat, label: Lifts, property: lift, agg: count, back: 7, target: 3 }
```

`count` counts days where the property is truthy, so it suits checkboxes.
`delta` is last minus first inside the window. A stat with no data shows `—`.

### `type: heatmap`

| Key | Meaning |
|-----|---------|
| `property` | Key that marks a day as active |
| `title` | Heading (defaults to the property name) |
| `color` | `#rrggbb`; shading is five alpha steps of it |
| `intensity` | Numeric key used to shade each box |
| `streak` | `true` to show how many days in a row are filled in |

**Range.** See [Ranges](#ranges). Defaults to the current calendar year.

**Streak.** Counts back from today over every day you have, not just the ones on
screen, so a six month window still reports a two hundred day run in full. A day
counts when its box is shaded, which means `intensity` days count even where the
main property is blank.

Today not being written up yet does not break the run: the count then ends
yesterday. Without that a streak would read zero every morning until you filled
the day in, which is the opposite of encouraging.

### `type: line`

| Key | Meaning |
|-----|---------|
| `property` | Numeric key to plot |
| `rolling` | Rolling average window in days |
| `title`, `color`, `unit` | Presentation |

**Range.** See [Ranges](#ranges). Defaults to every reading you have.

`rolling` and `days` are both day counts but mean different things: `days` sets
which readings are shown, `rolling` sets how many days each averaged point
covers. They combine freely, and the average is computed from readings just
before the window too, so a windowed chart does not start cold.

The rolling average uses a **calendar** window, not a count of readings, so gaps
in logging do not distort it. Dots are individual readings; the line is the
average.

### `type: note`

Embeds another note, rendered through Obsidian's own markdown pipeline, so
wikilinks, embeds, callouts, tasks and other plugins' code blocks behave exactly
as they do in a normal note.

| Key | Meaning |
|-----|---------|
| `path` | The note to show, written as you would inside `[[ ]]` |
| `height` | Visible height in pixels before the tile scrolls. Defaults to 320 |
| `title` | Caption. Defaults to the note's own path |

```yaml
- type: note
  title: This week
  path: 0 All/Health.md
  height: 280
```

Frontmatter is stripped: a tile shows the note's prose, not a property table.

The tile scrolls internally rather than growing, and **remembers where it was
scrolled to**. That matters more than it sounds: the dashboard redraws whenever
any note in the vault changes, so without it a tile you had scrolled would jump
back to the top while you typed somewhere else.

A note tile refreshes on its own when the note it shows is edited.

### `type: blank`

A placeholder that holds space and shows nothing. It reads no frontmatter and
needs no configuration, so it is there to try a layout with before deciding what
belongs in each slot.

| Key | Meaning |
|-----|---------|
| `height` | How tall it stands, in pixels. Defaults to 120 |

```yaml
- type: row
  children:
    - { type: line, property: weight, flex: 2 }
    - { type: blank, flex: 1 }
```

Nothing is drawn: it is an invisible spacer, so it also works for pushing a
row's other children into place. Use `flex` to try column widths and `height` to
try row heights.

### `type: weather`

Current conditions and a short forecast, from
[Open-Meteo](https://open-meteo.com). No API key and no account: type a place
name and it works.

| Key | Meaning |
|-----|---------|
| `place` | Any place name, resolved to coordinates once and remembered |
| `days` | Forecast days shown under the current conditions. Defaults to 3 |
| `units` | `fahrenheit` (default) or `celsius` |
| `title` | Caption. Defaults to the place name |

```yaml
- type: weather
  place: Denver
  days: 4
```

The headline is today: temperature, conditions, and the feels-like when it
differs from the actual. The strip below starts tomorrow, since repeating today
in both would waste a column. A day shows its chance of rain only at 20% or
above, because a 3% chance is not information.

**It is the one widget that leaves your vault.** A place name goes to
Open-Meteo's geocoding endpoint and coordinates go to its forecast endpoint.
Nothing else is sent, and no key or account is involved.

Forecasts are cached for 30 minutes and coordinates for the session. That is
load bearing rather than an optimisation: the dashboard redraws whenever any
note in the vault changes, so an uncached widget would call out to the network
while you typed.

## Development

```sh
npm install
npm run dev        # watch build, deploys to the vault on each save
npm run build      # typecheck + minified build + deploy
npm test           # render every widget against a real vault
npm run lint       # oxlint with the vendored anti-slop ruleset
npm run lint:fix   # apply the autofixable rules
```

`npm test -- /path/to/vault` points the harness at a vault.

### Linting

[anti-slop](https://github.com/dmmulroy/anti-slop) is vendored under
`tools/oxlint/anti-slop/`, per its own guidance that it be copied in rather than
depended on. `@oxlint/plugins` is pinned to the exact oxlint version.

`oxlint.config.ts` turns the boundary rules off for `config.ts`, `store.ts`,
`ics.ts` and `data.ts`. Those four are the I/O boundary the rest of the codebase
relies on: they take `unknown` from YAML, `data.json`, a calendar feed and note
frontmatter, and narrow it into domain types. The rules stay on everywhere else,
so that narrowing cannot leak past them.

`npm test` bundles the renderers against a stubbed `obsidian` module and a
minimal DOM, then asserts on the elements and numbers produced. Point it at a
vault:

```sh
npm test -- /path/to/vault
```

## Install

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/ultimate-dashboard/`, then enable it in
Settings → Community plugins.

## Design notes

- Colour comes from Obsidian theme variables, so widgets follow light and dark
  mode with no configuration.
- The block redraws when frontmatter changes, via a `metadataCache` hook.
- Config errors render inline in the note rather than failing silently, naming
  the widget and the problem.
