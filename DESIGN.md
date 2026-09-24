# Design System — The Burger Index

## Product Context
- **What this is:** A public index of what a burger costs in New York City. The headline number is the NYC median *index price* (the cheapest priced beef burger) across distinct menus: every independent restaurant once, and each chain once, however many locations share its menu. Around it: rankings by borough and neighborhood, a searchable table of every priced burger, restaurant pages, a price map, and a methodology page.
- **Who it's for:** Curious New Yorkers, food media quoting the number, and people screenshotting "my neighborhood is the priciest" to a group chat.
- **Project type:** Next.js static site reading `data/burger_index.json` (schema: `contract/burger_index.schema.json`). Every screen must survive a screenshot with no hover state.
- **References:** The Economist Big Mac Index (one number people quote), NYT Upshot (charts you can trust), diner peg letterboards, deli price cards with underlined superscript cents, menu boards with dotted leaders.

## Aesthetic Direction
- **Direction:** "Menu board meets data desk." Newsprint paper, black letterboard, ketchup-red ink. Hierarchy comes from typography and rules (lines), not boxes and shadows.
- **Decoration level:** Minimal. Allowed ornament: the letterboard grooves, 2px ink section rules, and dotted menu leaders. Nothing else.
- **Mood:** Confident and a bit dry. It should read like a well-edited city desk that also knows where the good smash burgers are. Never cute, never cartoonish.
- **Signature element:** The Letterboard: the headline price set in white condensed numerals on a grooved black board, with deli-card superscript cents (see Components).

## Typography
All three families load through `next/font/google` with `display: 'swap'` and `subsets: ['latin']`, and are exposed as CSS variables.
- **Display: Big Shoulders** (variable; `axes: ['opsz']`; weights 800 and 900 only). A condensed signage gothic, used for the hero price, page titles, section heads and stat values. `--font-display: var(--bs), "Arial Narrow", sans-serif`.
- **Body: Newsreader** (variable; `axes: ['opsz']`; 400, 400 italic, 600). A news text face, used for ledes, methodology, and descriptive prose. `--font-body: var(--nr), Georgia, serif`.
- **UI + numeric: Libre Franklin** (variable; 400, 500, 600, 700). The Franklin Gothic lineage used for chart labels, nav, buttons, tables and every price outside display sizes. `--font-ui: var(--lf), "Helvetica Neue", Arial, sans-serif`.
- **Numerals:** `font-variant-numeric: tabular-nums lining-nums` on every price, count, percent, table cell, chip, tooltip and axis tick. The only exceptions are the hero board and stat-tile values: they use proportional lining figures, because tabular spacing looks loose at display sizes.
- **Money format:** In tables, chips and tooltips, always two decimals (`$16.00`). Display prices use price-card cents, meaning the cents are set at 0.45em, top-aligned, with a 0.06em underline, and the `$` is set at 0.5em, top-aligned. Percent deltas use a true minus sign (`−12%`). Counts get thousands separators (`1,284`).

| Token | Family / weight | Mobile px / LH | Desktop px / LH | Tracking | Use |
|---|---|---|---|---|---|
| display-xl | Big Shoulders 900 | 112 / 0.85 | 200 / 0.85 | −0.01em | Letterboard price only |
| display-l | Big Shoulders 800 | 44 / 0.95 | 72 / 0.92 | 0 | H1 (page / restaurant name) |
| display-m | Big Shoulders 800 | 30 / 1.0 | 40 / 1.0 | 0.005em | H2 section heads |
| display-s | Big Shoulders 800 | 24 / 1.05 | 28 / 1.05 | 0.01em | H3, card titles |
| stat | Big Shoulders 800 | 32 / 1.0 | 44 / 1.0 | 0 | Stat-tile values |
| lede | Newsreader 400 | 19 / 1.45 | 22 / 1.45 | −0.005em | Intro paragraph under H1 |
| body | Newsreader 400 | 17 / 1.6 | 18 / 1.6 | 0 | Prose (max 68ch) |
| body-s | Newsreader 400 | 15 / 1.5 | 16 / 1.5 | 0 | Footnotes, methodology asides |
| ui-l | Libre Franklin 500 | 16 / 1.4 | 16 / 1.4 | 0 | Nav, inputs, large buttons |
| ui-m | Libre Franklin 500 | 14 / 1.4 | 14 / 1.4 | 0 | Buttons, chips, table body |
| ui-s | Libre Franklin 500 | 13 / 1.35 | 13 / 1.35 | 0.005em | Secondary table lines, captions |
| label | Libre Franklin 600 | 12 / 1.2 | 12 / 1.2 | 0.08em, UPPERCASE | Overlines, table headers, stat labels |
| num-l | Libre Franklin 600 tnum | 18 / 1.2 | 20 / 1.2 | 0 | Restaurant-page menu prices |
| num-m | Libre Franklin 600 tnum | 15 / 1.3 | 15 / 1.3 | 0 | Table prices, chip prices |
| num-s | Libre Franklin 500 tnum | 12 / 1.2 | 12 / 1.2 | 0 | Axis ticks, deltas, counts |

Use sentence case everywhere except `label`. The minimum text size is 12px, and 11px is allowed only for the index tag.

## Color
Approach: warm neutrals do almost all the work. Ketchup red is the one UI accent, and mustard is reserved for highlights. Data colors (the price ramp and borough colors) never appear on UI chrome, and `--accent` never appears on a data mark. Tokens live on `:root`. Dark values are declared under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again under `:root[data-theme="dark"]`. Set `color-scheme` to match, and give `body` an explicit `background: var(--bg)`.

| Token | Light | Dark | Role |
|---|---|---|---|
| --bg | #F5F1E8 | #121110 | Page (butcher paper) |
| --surface | #FFFDF8 | #1B1916 | Cards, table, chart plane, inputs, tooltips |
| --surface-2 | #EDE7DA | #25221E | Table header, row hover, neutral badges |
| --ink | #1C1915 | #F3EEE4 | Primary text, section rules, emphasis marks |
| --ink-muted | #5C554C | #AAA194 | Secondary text, placeholders, axis labels |
| --line | #DDD5C6 | #332F29 | Hairline dividers, card borders (decorative) |
| --line-strong | #8A8174 | #7A7266 | Input/chip borders, table-header rule |
| --grid / --axis | #E8E1D3 / #A69C8D | #2A2723 / #4D473F | Chart gridlines / baseline (decorative) |
| --bar | #7A7166 | #8C8377 | Neutral data bars |
| --accent | #B8261B | #F2604C | Ketchup: primary button, links, active nav |
| --accent-hover | #9C1F16 | #FF7A66 | Hover/pressed accent |
| --accent-ink | #FFFFFF | #1A0A07 | Text/icons on --accent |
| --accent-tint | #F6E0DB | #3A1F1A | Selected row, active-sort column wash |
| --highlight-tint | #FBEFC7 | #3A3117 | Mustard: `<mark>` search hits, index-item row, delivery badge |
| --highlight-edge | #8F6B0C | #C99A2A | Delivery badge border |
| --focus | #1F5FD6 | #86AEFF | Focus ring only |
| --board / --board-frame | #181614 / #3A352F | #0C0B0A / #6E665B | Letterboard felt / aluminum frame |
| --board-ink / --board-muted | #F8F3E7 / #B5AB9C | #F8F3E7 / #A9A08F | Letterboard numerals / small text |
| --map-land / --map-water | #ECE6DA / #CFDCDD | #1F1D1A / #15212A | Basemap |
| --map-park / --map-border / --map-label | #DFE3CF / #B9AE9C / #5C554C | #1E231B / #4D473F / #AAA194 | Basemap |
| --pin-ring | rgba(28,25,21,.55) | #121110 | Map pin outline |
| --ok-bg / --ok-icon | #E2EEDD / #2D6A2E | #1C2B1D / #6FC77A | Status: priced |
| --warn-bg / --warn-icon | #F7EACB / #8A5A00 | #33290F / #E7B54A | Status: no_prices |
| --err-bg / --err-icon | #F6DDD8 / #A3261C | #3A1C18 / #FF7B69 | Status: error |

**WCAG contrast (light | dark), computed with a script, not estimated.**
- Text pairs (need 4.5 or more). ink on bg 15.53 \| 16.31; on surface 17.23 \| 15.17; on surface-2 14.21 \| 13.69. ink-muted on bg 6.52 \| 7.40; on surface 7.23 \| 6.88; on surface-2 5.96 \| 6.21. accent on bg 5.59 \| 5.89; on surface 6.20 \| 5.47. accent-ink on accent 6.30 \| 6.01; on accent-hover 8.01 \| 7.55. ink on accent-tint 13.85 \| 13.06; on highlight-tint 15.24 \| 11.13; on ok-bg 14.60 \| 12.86; on warn-bg 14.66 \| 12.40; on err-bg 13.55 \| 13.36. surface on ink (inverse chip) 17.23 \| 15.17. board-ink on board 16.30 \| 17.76. board-muted on board 7.97 \| 7.60. map-label on map-land 5.91 \| 6.59.
- UI and graphics pairs (need 3 or more). line-strong on surface 3.77 \| 3.70; on bg 3.40 \| 3.98. focus on bg 5.08 \| 8.54; on surface 5.63 \| 7.95; on board 3.15 \| 8.91. ok-icon 5.45 \| 7.17, warn-icon 4.96 \| 7.58, err-icon 5.70 \| 6.10 (each against its own bg). highlight-edge 4.27 \| 4.99. bar on surface 4.71 \| 4.70. pin-ring on map-land 3.68 in light. In dark, the pin ring only separates overlapping pins, because the dark pin fills clear 3:1 against the land by themselves.
- `--line`, `--grid` and `--axis` are decorative (tick labels carry the values), so no minimum contrast applies. Never use them for text or for input borders.

### Price ramp (cheap → expensive): "mustard to char"
This is a sequential, analogous heat ramp: hue moves yellow → red while lightness falls steadily, so the order still reads under CVD, in grayscale and on print. Bins are measured against the **citywide** `stats.index_median` (m), never against a filtered subset, so a pin keeps its color when filters change.

| Step | Name | Rule | Light | Dark | Contrast vs --surface (L \| D) |
|---|---|---|---|---|---|
| --price-1 | Steal | p ≤ 0.70m | #DEA41B | #F7CB58 | 2.19 \| 11.39 |
| --price-2 | Deal | 0.70m < p ≤ 0.85m | #DB7B06 | #F9A136 | 3.02 \| 8.50 |
| --price-3 | Going rate | 0.85m < p < 1.15m | #D24E00 | #F17633 | 4.28 \| 6.16 |
| --price-4 | Pricey | 1.15m ≤ p < 1.30m | #B52C22 | #E1503B | 6.17 \| 4.52 |
| --price-5 | Splurge | p ≥ 1.30m | #881E2A | #C53443 | 9.12 \| 3.30 |

Validated with the dataviz `validate_palette.js --ordinal` check. Lightness is monotone in both modes. Adjacent ΔL is 0.079–0.094 in light and 0.074–0.081 in dark (the floor is 0.06). The light end clears the 2:1 minimum (light 2.19, dark 3.30). The single-hue check fails by design (62°/68° spread), because this is the allowed semantic-heat exception, and it always ships with a legend. The worst adjacent CVD ΔE is 7.7 (deutan), inside the 6–8 band, so **secondary encoding is mandatory**: every colored mark has a bin name and dollar range in the legend, histogram position, and a price in its tooltip, chip and table row. The legend always prints both forms, for example "Steal · ≤ $11.55 (−30%)", with dollar thresholds computed from m.

### Borough palette (categorical, fixed order: never cycled, never re-sorted)
| Borough | Light | Dark |
|---|---|---|
| Manhattan | #005BB3 | #2F7DD9 |
| Brooklyn | #AB3B79 | #B2417F |
| Queens | #018C3F | #33AC5A |
| Bronx | #734DBE | #7A59C3 |
| Staten Island | #09A0A0 | #05A7A7 |

Validator results, adjacent pairs: light passes, with worst CVD ΔE 8.8, worst normal-vision 23.9, and every color at 3:1 or more on #FFFDF8. Dark passes, with worst CVD 13.7, normal-vision 23.8, and 3:1 or more on #1B1916. On all-pairs, only the first three (Manhattan, Brooklyn, Queens) pass. The rules that follow from this:
- Borough colors are for identity only, as a 10px key dot beside the borough name in the rankings, borough page header, and legends.
- Never use them in a scatter or map, never next to price-ramp colors in the same chart, and never without the text label.

## Data visualization rules
- **Form:** The headline is a board, not a chart. Use a histogram for the distribution, horizontal bars for the five boroughs, and a dot-and-range plot for neighborhoods. No pies, no dual axes, no 3D, no area-of-circle encodings.
- **Histogram (index prices):** Bins are $1 at ≥768px and $2 below that. The domain runs from p1 to p99, with end bins labeled "≤ $X" and "$Y+". Each bar is filled with the `--price-n` of its bin midpoint, so the histogram doubles as the map legend. Leave a 2px surface-colored gap between bars. Round the data end with radius `min(4px, barWidth/3)` and keep the baseline end square. The plot is 240px tall on mobile and 320px on desktop; the container also includes a 32px x-axis band, so the chart never scrolls internally.
- **Axes:** No y-axis line. Use 3–5 clean y ticks (0, 25, 50…) with solid 1px `--grid` gridlines and a solid 1px `--axis` baseline. X ticks go every $5 (`$15`). Tick labels are num-s in `--ink-muted`. Never use dashed rules.
- **Median annotation:** A 2px `--ink` vertical line through the plot, with the label "NYC median $16.50" (ui-s, weight 600, `--ink`) above the plot. Add at most two more annotations per chart, in ui-s `--ink-muted` with a 1px `--axis` leader. Text never uses a data color.
- **Borough bars:** Bars start at $0, are sorted high → low, 20px thick in 36px rows, and filled with `--bar`. The hovered or current borough gets `--ink`. The value goes at the bar tip (num-m, `--ink`). The citywide median is a 1px `--ink` reference line labeled "NYC". The borough key dot sits beside the name.
- **Neighborhood plot:** A 10px `--ink` dot marks the median, with a 2px `--axis` line from `index_min` to `index_max`. Rows are 28px and sorted by median. Only areas with 5 or more distinct priced menus are ranked (a chain counts once per area, so five 7th Street Burgers are one menu); the rest are listed under "Too few to rank". A chain-only area carries "Chain prices only" beside its name.
- **Minimums:** Don't draw a histogram with fewer than 20 distinct priced menus in the slice. Show the empty state instead.
- **Counting unit:** Histograms, typical ranges, rankings, cheapest/priciest lists and every threshold count distinct menus (menu key = chain, else restaurant). Map pins, restaurant pages and table rows count locations, and any location count in copy says "locations" (or "pins").
- **Tooltips:** On `--surface` with a 1px `--line` border, radius 4px, `--shadow-pop`, padding 8×12. The value comes first ("142 menus", ui-m 700), then context ("$15.00–$15.99 · Going rate", ui-s `--ink-muted`), with a 12×2px line key in the mark's color. The same content appears on keyboard focus: a chart is one tab stop, and ←/→ move between marks. Hit targets are at least 24px, larger than the mark. Insert labels with `textContent`.
- **Text alternative:** Every chart is a `<figure>`. The `<figcaption>` holds a title plus a one-sentence takeaway, for example "Most NYC burgers cost $12–$22; the median is $16.50." The SVG gets `role="img"` and `aria-labelledby` pointing at them. A "View as table" toggle swaps in a real `<table>` of the same numbers.
- **Filter changes:** Charts keep their previous frame at 50% opacity until the new data renders. No skeletons, no layout jump.
- **Empty state:** A `--surface` box the chart's height, with a 1px `--line` border and centered ui-m `--ink-muted` copy (see Voice).

## Spacing, Layout, Surfaces
- **Spacing (4px base):** --space-1 4, -2 8, -3 12, -4 16, -5 24, -6 32, -7 48, -8 64, -9 96. Major sections are separated by 48px on mobile and 96px on desktop, each section opening with a 2px `--ink` rule, then 16px, then the H2.
- **Breakpoints (mobile-first):** base 375–639, `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The page never scrolls horizontally at 375px. Set `min-width: 0` on flex and grid children, and `overflow-wrap: anywhere` on names and URLs.
- **Grid:** 4 columns with 16px gutter and margins at base. 8 columns with 24px gutter and margins at `md`. 12 columns with 24px gutter and 32px margins at `lg`.
- **Max widths:** Content is 1200px (`--max-page`), prose is 680px (`--max-prose`), and the map is full-bleed up to 1440px.
- **Radii:** --radius-1 2px (badges, price chips, swatches, index tag). --radius-2 4px (buttons, inputs, cards, tooltips, board). --radius-pill 999px (filter chips, theme toggle only).
- **Borders:** 1px `--line` hairlines, 1px `--line-strong` on interactive boundaries, and 2px `--ink` section rules. Use rules instead of boxes wherever possible.
- **Shadows:** `--shadow-pop` is `0 1px 2px rgba(28,25,21,.08), 0 8px 24px rgba(28,25,21,.12)` in light and `0 8px 24px rgba(0,0,0,.5)` in dark, and is used only for tooltips, popovers and sheets. The board uses `inset 0 2px 8px rgba(0,0,0,.6)`. Cards get no shadow.

## Components
- **The Letterboard (headline price tag):**
  - **Board:** `--board` background with grooves (`repeating-linear-gradient(to bottom, transparent 0 7px, rgba(255,255,255,.035) 7px 8px)`), a 6px `--board-frame` border, radius 4px, and the board inset shadow. Padding is 20×20 on mobile and 32×40 on desktop.
  - **Content, top to bottom:** First, a `label` overline in `--board-muted`: "THE BURGER INDEX · NYC MEDIAN". Next, the price in display-xl `--board-ink`, with `text-shadow: 0 1px 0 rgba(0,0,0,.55)` for plastic-letter relief, and cents as price-card superscript with underline. Last, a ui-m `--board-muted` line: "Cheapest beef burger on 1,284 menus · Updated Sep 23, 2026". While part of the restaurant list is not yet looked up, the line gets a middle part, "80 of 658 restaurants looked up so far", and each part wraps as a unit; it disappears once nothing is pending.
  - **Behavior:** The board stays black in both themes. Glyph spans are `aria-hidden`, with an sr-only "$16.50". The same layout, at 1200×630, is the Open Graph image.
  - **Placement:** Exactly one per page. On the home page it spans columns 6–12 at `lg`, and sits under the H1 on mobile.
- **Stat tile:** A 2px `--ink` top rule, then 12px, then the `label` in `--ink-muted`, the value in `stat` (price-card cents for money), and a ui-s `--ink-muted` sub-line. Tiles have no box and are separated by 1px `--line` vertical rules at `md` and up. They stack two per row on mobile. While part of the list is not yet looked up, the home "Burgers priced" tile becomes "Looked up so far" (N, of M restaurants on our list); it reverts once nothing is pending.
- **Price chip:** Inline-flex, 24px tall, padding 0 8px, 1px `--line` border, radius 2px, `--surface` background. It contains an 8px `--price-n` square swatch, the price (num-m `--ink`), and the delta (num-s `--ink-muted`, e.g. "+12% vs NYC", or "at median" when |Δ| < 0.5%). Deltas are never red or green.
- **Data table:** The header is sticky at `top: var(--nav-h)` (56px), with `--surface-2` background, `label` type, 40px height, and a 1px `--line-strong` bottom rule. Sortable headers are buttons with `aria-sort` and an arrow icon. Rows are at least 48px, with 1px `--line` dividers, `--surface-2` on hover, and a 16px cell padding-x.
  - **Columns:** Numeric columns (Price, vs median, counts) are right-aligned tnum. Price is num-m 600. The index-setting burger gets the index tag. Delivery-app prices get a "†" suffix, explained in a footnote under the table.
  - **Below `sm`:** The table collapses to two columns. The left cell holds the burger (ui-m 600), then "restaurant · neighborhood" (ui-s muted), then the source badge. The right cell holds the price chip.
  - **Paging:** "Load 100 more" with "Showing 100 of 4,812". Never infinite scroll.
- **Index tag:** "INDEX PRICE", 11px Libre Franklin 700 at 0.08em tracking, `--surface` on `--ink`, radius 2px, 18px tall. On restaurant pages, the index row also gets a `--highlight-tint` background.
- **Filter bar:** One row above everything it scopes. It holds the search, then Borough (multi-select), Price range, Protein, "Hide delivery-app prices", and Sort.
  - **Filter chips:** 32px, pill, 1px `--line-strong` border, ui-m. Active chips are inverse (`--ink` background, `--surface` text) with an × to clear, and a "Clear all" ghost button follows.
  - **Below `md`:** Search plus a "Filters (n)" button that opens a bottom sheet. Chips wrap and never scroll sideways.
- **Search input:** 44px tall, `--surface`, 1px `--line-strong` border, radius 4px, a 16px search icon inset 12px, ui-l text. Placeholder: "Search burgers, restaurants, neighborhoods", shortened to "Search burgers, restaurants" below `sm` (at 375px the full text needs about 330px and the input leaves about 290px after the icon inset). A clear × shows when filled. `/` focuses the input (hint shown at `lg`). Matches are wrapped in `<mark>` with a `--highlight-tint` background.
- **Cards:** Restaurant cards on mobile results and the cheapest/priciest callouts. `--surface`, 1px `--line`, radius 4px, padding 16px. The whole card is clickable through a stretched link on the name. Hover changes the border to `--line-strong`.
- **Restaurant menu list:** A menu-board layout: the name (ui-l), a dotted leader (`border-bottom: 1px dotted var(--line-strong)` flex filler), then the price (num-l), with the description below in body-s `--ink-muted`.
- **Source badges:** 22px, radius 2px, 1px `--line-strong` border, 12px ui weight 500 in `--ink-muted`, with a 14px icon. Labels:

  | Value | Label | Icon |
  |---|---|---|
  | official_site | Restaurant site | Globe |
  | official_pdf | Menu PDF | FileText |
  | online_ordering | Online ordering | ShoppingBag |
  | menu_aggregator | Menu aggregator | BookOpen |
  | delivery_app | Delivery app † | Bike |

  The **delivery_app** badge uses a `--highlight-tint` background, a `--highlight-edge` border and `--ink` text. Its tooltip, also written out on restaurant pages, reads: "Delivery-app prices usually run higher than ordering in person."
- **Status badges:** Same shape as the source badges, with `--ink` text at weight 600 and a colored icon. The color is never the only signal.

  | Status | Label | Background | Icon |
  |---|---|---|---|
  | priced | Priced | `--ok-bg` | CircleCheck (`--ok-icon`) |
  | no_prices | No prices online | `--warn-bg` | CircleHelp (`--warn-icon`) |
  | no_burgers | No burgers | `--surface-2` | CircleSlash (`--ink-muted`) |
  | no_menu_found | No menu found | `--surface-2` | FileX (`--ink-muted`) |
  | error | Scrape failed | `--err-bg` | TriangleAlert (`--err-icon`) |

- **Map pin and legend:**
  - **Pins:** A circle filled with `--price-n` and a 1.5px `--pin-ring`. Diameter is 8px below zoom 12 and 12px at zoom 12 and above. Hover or select grows it to 16px with a 2px `--ink` ring on top. The hit target is 24px, and there is no clustering.
  - **Draw order:** Sorted by a hash of the id, so neither end of the ramp buries the other.
  - **Legend:** A `--surface` card in the top-left, 1px `--line`, radius 4px. It shows five swatch rows, each with its name, $ range and % range, plus the note "Colors vs NYC median $16.50". It collapses to a "Legend" button below `md`.
  - **Basemap:** Land, water, parks, borough borders and neighborhood labels (`label` in `--map-label`) only. No POIs and no business names.
  - **List fallback:** A list view toggle sits beside the map, because a map is never the only way to reach a restaurant.
- **Nav:** 56px, sticky, `--bg` with a 1px `--line` bottom border. The wordmark "THE BURGER INDEX" is Big Shoulders 900 at 22px, with "THE" set at 60%.
  - **Links:** Index · Map · Boroughs · Methodology, in ui-m. The active link gets a 2px `--accent` underbar.
  - **Right side:** A search icon and the theme toggle.
  - **Below `md`:** The wordmark plus a Menu button that opens a full-height sheet.
- **Footer:** A 2px `--ink` rule, then 48px of padding and three columns (one on mobile):
  - The data line: "Updated Sep 23, 2026 · 1,284 menus at 1,530 locations priced".
  - The links.
  - The disclaimer: "We index prices, not quality. Not affiliated with any restaurant."
- **Buttons:** Sizes are sm 32 / md 40 / lg 48px tall, padding-x 12/16/20, Libre Franklin 600 at 14/14/16px, radius 4px. The touch hit area is at least 44×44.
  - **Primary:** `--accent` background, `--accent-ink` text, `--accent-hover` on hover.
  - **Secondary:** Transparent with a 1px `--ink` border and `--ink` text; hover adds a `--surface-2` background.
  - **Ghost:** `--ink-muted` text, turning `--ink` and underlined on hover.
  - **Pressed:** `translateY(1px)`.
  - **Disabled:** 40% opacity with `cursor: not-allowed`.
- **Links:** In prose, `--accent` text with a 1px underline at 0.18em offset. Hover switches to `--accent-hover` with a 2px underline. Visited links look the same. UI links (nav, table names) are `--ink` with no underline until hover.
- **Focus ring:** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }` everywhere. Table rows and cards use an offset of −2px (inset). Never remove it, and never use `--accent` for focus.
- **Theme toggle:** A 40px icon button in the nav: Sun is shown in dark mode, Moon in light mode. The first paint follows the system setting. A click sets `data-theme` on `<html>` and stores `bi-theme` in `localStorage`, with reads and writes wrapped in try/catch. An inline `<head>` script applies it before paint so there is no flash. A footer link "Use system setting" clears the stored value.

## Motion
- **Tokens:** `--dur-1` 120ms (hover, color), `--dur-2` 200ms (tooltips, popovers, sheets), `--dur-3` 320ms (chart entrance). `--ease-out: cubic-bezier(.2,.7,.2,1)`, `--ease-in: cubic-bezier(.4,0,1,1)`.
- **The one expressive moment:** On first load, the Letterboard glyphs slide up 8px and fade in over 280ms each, staggered 40ms apart. They never replay.
- **Charts:** Bars grow from the baseline once, the first time the chart enters the viewport (320ms total, stagger capped at 240ms). They never re-animate on filter changes.
- **Not allowed:** Count-up numbers, parallax, scroll-jacking, or looping motion.
- **Reduced motion:** Under `prefers-reduced-motion: reduce`, set every duration to 0ms and skip the entrances. Content must be complete at t=0.

## Iconography & Imagery
- **Icons:** `lucide-react` only, rendered as inline SVG with stroke 1.75, `currentColor`, round caps and joins. Sizes are 16px next to 14px text and 20px in buttons and nav. Icon-only buttons get an `aria-label`. No filled icon sets, no emoji, and no burger icons or illustrations (a hamburger menu icon is allowed).
- **Imagery:** None. No food photos, no stock images, no AI illustrations. The numbers, the board and the map are the visuals. Social images are generated from the Letterboard layout.

## Voice & Copy
Lead with the number, keep a straight face, and allow at most one dry line per screen. Use "we", sentence-case headings, no exclamation marks, and never a pun in a heading.
- **Hero:** H1 "What a burger costs in New York." Lede: "We looked up 1,400 New York restaurants and 30 chains (2,100 locations in all) and recorded the cheapest beef burger on every menu we could price: 1,284 menus. A chain counts once, however many locations it has. Half of those menus charge more than $16.50. Half charge less."
- **Section heads:** "The priciest borough is still Manhattan." / "Where $12 still gets you lunch."
- **Empty search:** "No burgers match “truffle smash” in Staten Island. Try fewer filters."
- **Status copy:**
  - no_burgers: "Menu found, but no beef burger on the page we read."
  - no_prices: "There's a burger on the menu, but no price online. Market price, apparently."
  - no_menu_found: "We couldn't find a menu online for this place."
  - error: "Our scraper choked on this menu. It tries again next update."
- **Too few:** "Only 3 priced menus here. Not enough to call it a trend."
- **Chain prices only:** An area (borough or neighborhood) with priced chain menus but no priced independent restaurant says so in exactly these words, as a badge (Store icon, source-badge shape) on its page and as a label on every chart row, table row and list row. Its median is never set beside another area's as a like-for-like comparison, gets no Letterboard and no "vs NYC" delta. Copy is computed from the data, never a hard-coded borough name.
- **Methodology tone:** Plain, specific and auditable. Open with the rule itself: "A restaurant's index price is its cheapest beef burger." Then explain why (it's the price of admission, and it isn't skewed by $40 wagyu specials), then list sources, exclusions, known biases (delivery markups, stale PDFs) and dates. No hedging adjectives and no marketing.

## Don'ts
- No purple or blue gradients, glassmorphism, neon glows, grain overlays, or cards with drop shadows.
- Don't use Inter, Roboto or the system-ui default look. No novelty or "fun" fonts (Bangers, Cooper, Lobster), and no scripts.
- No emoji, burger clipart or food photos anywhere, including OG images and empty states.
- No rainbow or red/green price scales. Don't use `--accent` on data marks, price-ramp colors on UI, or borough colors in a map or scatter.
- No color-only encoding. No tooltip-only values. No dual axes, pies, dashed gridlines, or center-aligned numbers.
- No tabular figures on the board or stat values, and no proportional figures anywhere else.
- Don't use "best", "top-rated" or quality language. We index price.
- No horizontal page scroll at 375px, and no text over the map without a `--surface` backing.
- No puns in headings ("Bun-believable") and no ALL-CAPS body text.

## Key Design Decisions
- **Letterboard over a KPI tile:** The dataviz method puts hero numbers in the UI sans. We deliberately break that for one element, because the board is the brand and the screenshot. Every other number follows the method (Franklin tnum).
- **Analogous heat ramp:** Mustard → ketchup → char is appetizing, obviously ordered, and survives CVD and print through monotone lightness. The mid bin ("Going rate", ±15%) is where most restaurants land.
- **Ketchup accent, rules not boxes:** The accent gives newspaper credibility with diner warmth. The accent/ramp overlap is managed by strict role separation.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-23 | Initial design system | Written for the Next.js build; the palettes were checked with the dataviz validator and a WCAG contrast script |
| 2026-09-23 | Big Shoulders + Newsreader + Libre Franklin | Signage display, news body, and Franklin data labels (Upshot lineage) |
| 2026-09-23 | Price bins at ±15% / ±30% of the citywide median | Colors stay stable under filters, and bin names make good share copy |
| 2026-09-23 | Chains count once: every figure, chart, ranking and threshold counts distinct menus; chain-only areas are labelled "Chain prices only" | User decision. A chain's locations share one scraped menu, so counting locations let 150+ McDonald's copies set the city number and fill the cheapest lists. So far only Manhattan has independent restaurants priced, and chain medians elsewhere must not read as borough prices |
| 2026-09-23 | National fast-food chains removed from the index (McDonald's, Burger King, Wendy's, White Castle, Checkers, Sonic, Five Guys, Smashburger, Shake Shack); NYC's own small chains (7th Street Burger, Jimbo's, Bareburger, Jackson Hole, Burger Joint, Harlem Shake) stay and still count once | User decision (the user chose to remove Shake Shack too). The other national burger and casual-dining brands listed in `pipeline/chains.py` are left out as well |
| 2026-09-23 | Partial-coverage state: while restaurants on the list are not yet looked up, the Letterboard line and OG image add "N of M restaurants looked up so far" and the home "Burgers priced" tile becomes "Looked up so far"; no_burgers reads "Menu found, but no beef burger on the page we read." | User decision. The index is mostly one neighborhood until the list is scraped, and must not read as citywide; every no_burgers row is on the user's curated burger list, so "No burgers on it" read as contradicting it |
