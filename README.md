# Ultimate Dashboard

An Obsidian plugin that renders stat tiles, year heatmaps and rolling-average
line charts from daily note frontmatter, driven by a declarative YAML layout.

No runtime dependencies. It reads frontmatter through Obsidian's own
`metadataCache` and draws every panel itself, so it needs neither Dataview nor
Heatmap Calendar.

## Using it

Run **Ultimate Dashboard: Open dashboard** from the command palette, or click the
ribbon icon. Running it again focuses the existing tab rather than opening a
second one.

### Editing

The pencil opens edit mode, which has two tabs.

**Visual** is a palette and a canvas. Drag a panel type onto a drop zone to add
it; drag one already on the canvas to move it anywhere, including into a
divider. Dropping a type that needs settings, like a heatmap with no property
yet, opens its configuration straight away.

Each card carries up and down arrows to reorder it within its parent, a pencil
to reconfigure, and a bin to remove. The arrows are the dependable route:
dragging means hitting a gap, and inside a Columns divider those gaps are
narrow.

The palette's **dividers** are containers: *Columns* lays its children out side
by side, *Rows* stacks them. Drop panels inside one to segment the dashboard,
and nest them for more involved layouts.

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

## Layout YAML

```yaml
folder: Daily
minWidth: 520
panels:
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
| `columns` | `auto` | Fixed column count (1 to 12), or `auto` |
| `minWidth` | `520` | Column width the `auto` grid fits against. Ignored when `columns` is a number |
| `gap` | `20` | Space between panels, in pixels |
| `panels` | required | List of panels |

### Layout

Panels are leaves of a layout tree. Three container types hold `children`:

| Container | Behaviour | Sizes children with |
|-----------|-----------|---------------------|
| `column` | stacks vertically | `flex` |
| `row` | side by side, wrapping by default | `flex` |
| `grid` | CSS grid | `span` |

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

    - type: grid
      columns: 3
      children:
        - { type: heatmap, property: cardio, intensity: miles }
        - { type: heatmap, property: vitamins }
        - { type: heatmap, property: read, span: 1 }
```

Containers nest to 8 levels. The root must be a container, and a panel cannot
take `children`: wrap panels in a `row`, `column` or `grid` instead.

**Container options**

| Key | Applies to | Meaning |
|-----|-----------|---------|
| `gap` | all | Space between children, in px. Inherited when unset |
| `columns` | grid | `auto`, or a whole number from 1 to 12 |
| `minWidth` | grid | Column width the `auto` grid fits against |
| `wrap` | row | `false` to keep children on one line |

**Child sizing**

| Key | Valid inside | Meaning |
|-----|-------------|---------|
| `flex` | row, column | Growth factor, like CSS `flex-grow` |
| `span` | grid | Columns to occupy, or `full` |

Using the wrong one is an error naming the node, for instance
`layout > row[0]: \`span\` only applies inside a grid`. A numeric `span` needs
its grid to set a fixed `columns`, since an auto grid has no fixed column count;
`span: full` works in either. A `stats` panel inside a grid defaults to `full`.

Below 700px every row becomes a column and every grid a single track, so a
deeply nested dashboard stays readable in a split pane or on a phone.


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

The default differs by panel, because the panels differ: a heatmap must draw a
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

A month grid, like a wall calendar. Always six rows, so the panel does not
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
  span: full
```

An event spanning several days appears in every cell it covers. Both panels
refer to calendars by name, from the one pool configured in settings.

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
land in a single pool, and a panel picks from it by name, so one dashboard can
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

### Creating events

A calendar panel showing at least one writable Google calendar gets a `+` button
in its header. It asks for a title, date, times or all-day, and location, then
writes straight to Google. ICS panels have no button: the format has no write
verb.

The ICS reader handles folded lines, escaped text, all-day and timed events,
`EXDATE`, and `RRULE` for daily, weekly (including `BYDAY`), monthly and yearly
rules with `INTERVAL`, `COUNT` and `UNTIL`. It is not a complete RFC 5545
implementation: a `TZID` is read as local time, since resolving one properly
needs a timezone database.

### Flat form

The older flat form still works and is treated as a single grid:

```yaml
columns: 2
gap: 20
panels:
  - { type: stats, tiles: [...] }
  - { type: heatmap, property: lift }
```

Use `layout` or `panels`, not both.

### `type: stats`

Takes a `tiles` list. Each tile:

| Key | Meaning |
|-----|---------|
| `label` | Caption |
| `property` | Frontmatter key |
| `agg` | `latest`, `mean`, `sum`, `count`, `delta` |
| `days` | Rolling window; omit for all history |
| `target` | Renders as `value / target` |
| `unit` | Suffix |
| `precision` | Decimal places (default 1, or 0 for `count`) |

`count` counts days where the property is truthy, so it suits checkboxes.
`delta` is last minus first inside the window. A tile with no data shows `—`.

### `type: heatmap`

| Key | Meaning |
|-----|---------|
| `property` | Key that marks a day as active |
| `title` | Heading (defaults to the property name) |
| `color` | `#rrggbb`; shading is five alpha steps of it |
| `intensity` | Numeric key used to shade each box |

**Range.** See [Ranges](#ranges). Defaults to the current calendar year.

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

## Development

```sh
npm install
npm run dev        # watch build, deploys to the vault on each save
npm run build      # typecheck + minified build + deploy
npm test           # render every panel against a real vault
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

- Colour comes from Obsidian theme variables, so panels follow light and dark
  mode with no configuration.
- The block redraws when frontmatter changes, via a `metadataCache` hook.
- Config errors render inline in the note rather than failing silently, naming
  the panel and the problem.
