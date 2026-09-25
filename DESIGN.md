# Design System — The Burger Index

## Product Context
- **What this is:** A public index of what a burger costs in New York City. The headline number is the NYC median *index price* (the price of each restaurant's one burger, its highest-priced eligible beef burger; the pipeline defines it, see CLAUDE.md "One burger per restaurant", and the site never states it) across distinct menus: every independent restaurant once, and each chain once, however many locations share its menu. Around it: rankings by borough and neighborhood, a searchable table of every priced burger, a page for every priced restaurant and a price map. A restaurant without a price has no page; it appears only as a plain name on its neighborhood's page (see "Pages only for priced places"). The site shows the numbers and short labels only: it carries no methodology page and no copy explaining how the data is gathered, computed, counted, filtered, corrected or limited (see Voice & Copy, "No methodology copy").
- **"What's it worth?":** on every priced restaurant page, visitors say what they would pay for the menu's burger, in whole dollars from $5 to $75 (one answer per device, changeable). The crowd's median is **the People's Price**, shown next to the menu price with a verdict ("A bargain by 7%", "Overpriced by 43%", "Right on the money"). **/peoples-price** shows the People's Burger Index beside the real one and live boards (biggest bargains, most overpriced, most answered). The answers live in Supabase (`supabase/README.md`); the People's Price is the visitors' opinion, never ours, and the site never explains how any of it is computed (see "No methodology copy").
- **Who it's for:** Curious New Yorkers, food media quoting the number, and people screenshotting "my neighborhood is the priciest" to a group chat. This look adds a fourth group: people who share it because it's fun to look at.
- **Project type:** Next.js 16 static export (`web/`) reading `data/burger_index.json` (schema: `contract/burger_index.schema.json`). Every screen must survive a screenshot with no hover state.
- **The brief:** "Design the website as if it was a website for the Krusty Krab in SpongeBob." We read that as: the site *is* a cheerful seaside fry-cook joint on the sea floor. It is an **original homage**. It evokes a cartoon undersea burger shack through generic nautical and diner vocabulary (planks, rope, portholes, brass, life rings, a scalloped awning, a hanging order board, deep water) and copies nothing from the show. It claims no affiliation (see Don'ts). The brand stays **The Burger Index**.
- **What changed and what didn't:** Only the look and the voice. Routes, data, logic, numbers, rounding, counting units, thresholds and every data-bearing sentence fixed in the Decisions Log stay exactly as they are.
- **References (mood only, never sources):** Boardwalk burger stands and clam shacks (scalloped awnings, hand-painted order boards, red and yellow paint on weathered wood), ship interiors (portholes, brass rivets, rope rails, a service bell), diner guest checks, and Saturday-morning cartoon inking (thick outlines, flat cel shadows). The data desk still sets the rules: The Economist Big Mac Index (one number people quote) and NYT Upshot (charts you can trust).

## Aesthetic Direction
- **Direction: "The Restaurant."** The page is the building, top to bottom:

  | Page region | Part of the restaurant | Treatment |
  |---|---|---|
  | Nav | The front facade | Honey-wood plank sign board, rope trim along the bottom edge |
  | Under the nav | The awning | Red and cream scalloped stripes, full bleed, 30px, scrolls away |
  | Home hero | The view through the front window | Sea-teal water with caustic ripples at the surface, bubbles in the side gutters, a wave edge at the bottom. Kicker ticket, H1 and lede sit here |
  | Headline price | The order board over the counter | A yellow painted sign in a plank frame, hanging from a beam on two ropes, with an "ORDER UP!" plaque, a service bell on the beam and a life ring on the corner |
  | Stat tiles | Portholes along the counter | Cream cards with brass rims and rivets, a porthole badge bolted to the top-left (borough and neighborhood headers, the People's Price page) |
  | Inner-page header | The shallows | A half-height sea band behind breadcrumbs, kicker, H1 and lede |
  | Section breaks | Rope rails | An 8px twisted rope replaces the old 2px ink rule |
  | Charts, tables, cards | Menu cards on the counter | Plain cream paper, a thick soft border, a flat block shadow |
  | Footer | The deck | Dark stained deck planks under a rope rail |

- **The Two-Zone Rule** (how ornament is fenced in). The house motto is *cartoon on the walls, straight face on the numbers.*
  - **Atmosphere zones** (decoration allowed): nav, awning, home hero band, inner-page shallows band, the Order Board rig, stat-tile rims, rope rules, section kickers, empty-state spot art, the 404 page, the footer, and one control: the WorthPicker's rope slider, brass knob and "Order up!" ticket button.
  - **Data zones** (flat, no decoration): chart plot areas and axis bands, legends and swatches, tables, the map canvas, price chips, tooltips, the filter bar, the restaurant page's burger block, the hand-check note, the People's Price boards and the WorthPicker's results (the People's Price summary and the answer distribution). Data zones sit on flat `--surface` or `--bg` and use only the tokens below.
- **Decoration level:** Expressive in atmosphere zones, zero in data zones. Nothing from the building (planks, rope, net, caustics, bubbles, brass, drop shades, block shadows) ever enters a plot, the map canvas, a table cell, a tooltip, or sits behind running text without a solid backing.
- **Mood:** Cheerful, loud, proud of its burgers, and honest about the numbers. The voice is a fry cook who is a stickler for the receipt: the jokes go in the labels, never in the data.
- **Signature element: The Order Board.** The headline median in chunky red cartoon numerals with a dark sign-painter drop shade, on a yellow sign that hangs from a beam. It keeps the deli-card cents (superscript, underlined). It is the brand, the screenshot and the Open Graph image.
- **Dimensionality:** Chrome gets a thick soft edge and a **flat, solid offset shadow** (cel style, `0 4px 0`), never a blurry drop shadow. Data marks are always flat.

## Typography
All three families load through `next/font/google` with `display: 'swap'` and `subsets: ['latin']`, and are exposed as CSS variables on `<html>` (replacing Big Shoulders, Newsreader and Libre Franklin in `web/src/app/layout.tsx`).

```ts
import { Barlow, Lilita_One, Nunito } from "next/font/google";
const display = Lilita_One({ subsets: ["latin"], weight: "400", display: "swap", variable: "--lo", adjustFontFallback: false, fallback: ["Arial Rounded MT Bold", "Arial Black", "sans-serif"] });
const body = Nunito({ subsets: ["latin"], display: "swap", style: ["normal", "italic"], variable: "--nu" }); // variable wght 200–1000
const ui = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--ba" }); // static family
```

- **Display: Lilita One** (400, its only weight). A chunky, rounded, hand-lettered sign face with cartoon energy and very legible numerals. Used for the Order Board price, H1–H3, stat values, the wordmark, section kickers, the hero kicker ticket and the "ORDER UP!" plaque. `--font-display: var(--lo), "Arial Rounded MT Bold", "Arial Black", sans-serif`. Every display class sets `font-weight: 400; font-synthesis-weight: none`, because headings default to bold and the browser would otherwise fake one. Never below 15px.
- **Body: Nunito** (variable; 400, 400 italic, 700, 800). A rounded humanist sans that matches the display's soft corners and stays readable at paragraph length. Used for ledes, prose, menu-item descriptions and the footer disclaimer. `--font-body: var(--nu), "Trebuchet MS", sans-serif`.
- **UI + numeric: Barlow** (400, 500, 600, 700). A slightly rounded grotesk from the sign-painting and highway-plate lineage, warm next to Lilita but a proper data face. Used for nav, buttons, labels, chips, badges, tables, axis ticks, tooltips and every price outside display sizes. `--font-ui: var(--ba), "Helvetica Neue", Arial, sans-serif`.
- **Numerals (measured in a browser, not assumed):**
  - **Barlow:** `tabular-nums` works ("1111" and "0000" both 85.3px at 40px, weight 500). Its *default* figures are proportional, so `font-variant-numeric: tabular-nums lining-nums` is set on `body` and on every price, count, percent, chip, table cell, tooltip and axis tick.
  - **Nunito:** tabular by default (96.0px for both strings), so prices inside prose align too.
  - **Lilita One:** no tabular figures (65.0px against 102.3px). It may only set numbers that never align: the Order Board, stat-tile values and headings. It never sets a column, chip, tick or tooltip number.
  - Libre Franklin, the previous UI face, has no working `tnum` in its Google build ("1111" 76.6px against "0000" 111.0px with `tabular-nums` on), so the old tables were silently proportional. One more reason for the switch.
- **Money format:** In tables, chips and tooltips, always two decimals (`$16.00`). The one exception is "What's it worth?": answers, People's Prices and the People's Burger Index are whole dollars and never carry cents (`$29`), in tables too; the menu price beside them keeps its cents. Display prices use price-card cents: the cents at 0.45em, top-aligned, with a 0.07em underline, and the `$` at 0.5em, top-aligned. Percent deltas use a true minus sign (`−12%`). Counts get thousands separators (`1,284`).

| Token | Family / weight | Mobile px / LH | Desktop px / LH (≥768) | Tracking | Use |
|---|---|---|---|---|---|
| display-xl | Lilita One 400 | 112 / 0.90 | 200 / 0.90 | 0 | Order Board price only (red, with drop shade) |
| display-l | Lilita One 400 | 40 / 1.00 | 64 / 0.98 | 0.005em | H1 (page / restaurant name); `text-wrap: balance` (display-m too), so no word is left alone on a line |
| display-m | Lilita One 400 | 28 / 1.05 | 38 / 1.05 | 0.005em | H2 section heads |
| display-s | Lilita One 400 | 22 / 1.10 | 26 / 1.10 | 0.01em | H3, card titles |
| stat | Lilita One 400 | 30 / 1.0 | 40 / 1.0 | 0 | Stat-tile values and the restaurant page's burger price (proportional; price-card cents for money) |
| wordmark | Lilita One 400, UPPERCASE | 21 / 1.0 | 24 / 1.0 | 0.02em | "THE BURGER INDEX" ("THE" at 60%, raised 0.2em) |
| plaque | Lilita One 400, UPPERCASE | 18 / 1.0 | 22 / 1.0 | 0.04em | The "ORDER UP!" plaque only |
| kicker | Lilita One 400, UPPERCASE | 15 / 1.1 | 15 / 1.1 | 0.07em | Section kickers, hero kicker ticket |
| lede | Nunito 400 | 18 / 1.5 | 21 / 1.5 | 0 | Intro paragraph under H1 |
| body | Nunito 400 | 17 / 1.6 | 18 / 1.6 | 0 | Prose (max 68ch) |
| body-s | Nunito 400 | 15 / 1.5 | 16 / 1.5 | 0 | Menu-item descriptions, the footer disclaimer |
| ui-l | Barlow 500 | 16 / 1.4 | 16 / 1.4 | 0 | Inputs, large buttons (700), menu-list names (600) |
| ui-m | Barlow 500 | 15 / 1.4 | 15 / 1.4 | 0 | Nav (600), chips, table body, board small print |
| ui-s | Barlow 500 | 13 / 1.35 | 13 / 1.35 | 0.005em | Secondary table lines, captions, legend rows |
| label | Barlow 700, UPPERCASE | 12 / 1.2 | 12 / 1.2 | 0.10em | Overlines, table headers, stat labels, board overline, hand-check heading |
| num-l | Barlow 600 tnum | 18 / 1.2 | 20 / 1.2 | 0 | The burger block's comparisons ("+12%" vs neighborhood and NYC) |
| num-m | Barlow 600 tnum | 15 / 1.3 | 15 / 1.3 | 0 | Table prices, chip prices, legend ranges |
| num-s | Barlow 500 tnum | 12 / 1.2 | 12 / 1.2 | 0 | Axis ticks, deltas, counts |
| btn | Barlow 700 | 14 (sm, md) / 16 (lg) | same | 0 | Buttons |

Use sentence case everywhere except `label`, `kicker`, `plaque` and the wordmark. The minimum text size is 12px.

## Color
**Four families, each with one job; they never swap jobs.**
1. **Chrome** (galley red, sign yellow, honey wood, deck brown, brass, and the sea bands): the building. Never on a data mark.
2. **The price ramp, "Shallows to Trench"** (one sea hue, pale to deep): price only. Never on chrome.
3. **Borough flags** (five categorical hues): identity dots beside borough names only.
4. **Status** (ok / err): state, always with an icon and a label (the People's Price "Live" badge, the WorthPicker's error line).

Moving the price ramp from the old heat colors to the sea is what makes the loud red-and-yellow chrome safe: a "Pricey" swatch can no longer be mistaken for a red button, an active filter or the yellow board. `--accent` never appears on a data mark; ramp and borough colors never appear on chrome.

**Plumbing:** tokens live on `:root`. Dark values are declared under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again under `:root[data-theme="dark"]`. Set `color-scheme` to match, and give `body` an explicit `background: var(--bg)`. The Tailwind `@theme inline` block keeps `--color-*: initial` and maps only these tokens, so off-palette utilities can't sneak in. `viewport.themeColor` becomes `#F6ECD6` (light) and `#081B25` (dark).

**Dark mode is "Night shift": the deep sea after close.** Navy water, cream text, coral accent, and the order board stays lit (yellow, with a warm glow).

| Token | Light (Day shift) | Dark (Night shift) | Role |
|---|---|---|---|
| --bg | #F6ECD6 | #081B25 | Page: sea-floor sand / midnight water |
| --surface | #FFFAF0 | #0E2733 | Menu-card paper: cards, table, chart plane, inputs, tooltips, badges |
| --surface-2 | #F3E4C4 | #15343F | Table header, row hover, neutral badges |
| --ink | #2B1B10 | #F6EDDA | Primary text, median line, emphasis marks |
| --ink-muted | #6A4F3A | #A9C0C4 | Secondary text, placeholders, axis labels |
| --line | #E6D3AE | #1F4251 | Card borders, dividers (decorative) |
| --line-strong | #957550 | #628896 | Input/chip/badge borders, table-header rule |
| --grid / --axis | #EFE2C6 / #B89F7A | #173442 / #3E6272 | Chart gridlines / baseline (decorative) |
| --bar | #8A6D4E | #A58D70 | Neutral data bars ("driftwood") |
| --accent | #C4221B | #FF6B57 | Galley red / night coral: primary button, links, active nav tab, active filter chip, kickers |
| --accent-hover | #A11A14 | #FF8A78 | Hover/pressed accent |
| --accent-deep | #6E0F0B | #9E2B1E | Accent button border and solid press shadow (decorative) |
| --accent-ink | #FFFFFF | #1E0804 | Text/icons on --accent |
| --accent-tint | #FBE0D8 | #3D1E1C | Selected row, active-sort column wash |
| --highlight-tint | #FFEFB5 | #3B3416 | `<mark>` search hits, delivery badge, People's Price row flash |
| --highlight-edge | #8C6700 | #D9AA33 | Delivery badge border |
| --focus | #1648C8 | #8DB6FF | Focus ring only |
| --focus-halo | #FFFAF0 | #081B25 | Halo painted behind the focus ring in atmosphere zones |
| --sign | #FFCD3C | #FFCD3C | Order Board face (theme-invariant: the lit sign) |
| --sign-ink / --sign-price / --sign-shade | #3A1F0C / #B0170F / #3A1F0C | same | Board small print / price numerals / numeral drop shade |
| --sign-glow | none | `0 0 0 3px rgba(255,205,60,.18), 0 0 70px 6px rgba(255,205,60,.20)` | The board lights up at night (the one soft halo) |
| --plaque / --plaque-ink | #B0170F / #FFE08A | same | "ORDER UP!" plaque fill / letters |
| --wood-face / --wood-ink | #DDA764 / #2B1B10 | #4B2E17 / #F6EDDA | Nav facade planks / text on them |
| --wood-hover | rgba(58,31,12,.10) | rgba(255,240,210,.10) | Nav link and icon-button hover fill |
| --deck / --deck-ink / --deck-muted | #5A3A1E / #FFF4DE / #E6CFA8 | #2A190C / #F6EDDA / #D2BC98 | Footer planks and their text |
| --frame-1 / --frame-2 / --nail | #C68842 / #9A6128 / #5A3410 | #A8723A / #80521F / #3A2208 | Board frame, beam, nail heads (decorative) |
| --rope-1 / --rope-2 | #E2C089 / #A77C45 | #B89464 / #6F5130 | Rope texture (decorative) |
| --brass / --brass-hi / --brass-lo | #B8862E / rgba(255,236,190,.7) / #7A5415 | #A87A2A / rgba(255,226,160,.35) / #5E4010 | Tile rims, rivets, porthole rings, bell (decorative) |
| --glass / --glass-hi | #9FDCD6 / #E6FFFB | #0F4A57 / #2B8C9A | Porthole glass (badges, theme toggle) |
| --sea-top / --sea-bot | #A7E3DC / #62C3C3 | #0D3B48 / #072531 | Hero water gradient; inner-page shallows band starts at --sea-top |
| --caustic / --bubble / --foam | rgba(255,255,255,.55) / rgba(255,255,255,.8) / rgba(255,255,255,.7) | rgba(140,230,255,.13) / rgba(160,240,255,.5) / rgba(160,240,255,.22) | Surface ripples, bubbles, wave foam (decorative) |
| --awning-a / --awning-b | #C4221B / #FFF4DE | #B8392A / #E9DCC4 | Awning stripes |
| --net | rgba(149,117,80,.16) | rgba(98,136,150,.16) | Trap-net lines (decorative) |
| --block | #DCC79E | #04121A | Solid offset shadow under cards and tiles |
| --ring-a / --ring-b / --ring-line | #C4221B / #FFF4DE / #2B1B10 | #FF6B57 / #F6EDDA / #F6EDDA | Life-ring emblem |
| --slip / --slip-rule / --slip-margin | #EEF6E6 / #C9DDBE / #C8453A | #17302A / #2A4A40 / #E0685C | Guest-check order slip (hand-check note) |
| --swatch-ring | rgba(43,27,16,.38) | rgba(0,0,0,.45) | 1px ring on ramp swatches and chip stripes (lifts the pale step) |
| --map-land / --map-water / --map-park | #EFE3C8 / #C3D5D6 / #DCE3C4 | #102B37 / #061520 / #12302B | Basemap (water is desaturated slate so sea-ramp pins never sink into it) |
| --map-border / --map-label | #B59E7B / #6A4F3A | #36596A / #A9C0C4 | Basemap |
| --pin-ring | #6B5847 | #081B25 | Map pin outline |
| --ok-bg / --ok-icon | #DDF0D8 / #2B6A2E | #11332A / #6FD08A | The "Live" badge on /peoples-price |
| --err-icon | #A3221A | #FF7B69 | The WorthPicker's error icon |
| --price-1 … --price-5 | see ramp | see ramp | Price bins |
| --borough-* | see flags | see flags | Borough identity dots |

**WCAG contrast (light | dark), computed with a script (WCAG 2.x relative luminance), not estimated.**
- **Text pairs (need 4.5 or more):**
  - ink on bg 14.12 \| 15.12; on surface 15.93 \| 13.30; on surface-2 13.19 \| 11.31.
  - ink-muted on bg 6.41 \| 9.23; on surface 7.23 \| 8.13; on surface-2 5.98 \| 6.91.
  - accent on bg 4.98 \| 6.28; on surface 5.62 \| 5.52; on surface-2 4.65 \| 4.70.
  - accent-ink on accent 5.85 \| 6.86; on accent-hover 7.86 \| 8.39.
  - ink on accent-tint 13.22 \| 12.88; on highlight-tint 14.42 \| 10.69 (ink-muted 6.54 \| 6.53); on ok-bg 13.84 \| 11.79.
  - surface on ink (inverse chip) 15.93 \| 13.30.
  - wood-ink on wood-face 7.72 \| 10.60, and 6.01 \| 7.34 on the worst grain line (12% black / 12% white over the face).
  - deck-ink on deck 9.35 \| 14.52; deck-muted on deck 6.73 \| 9.16, and 5.34 \| 7.31 on the worst grain line (the deck tile's 8% white highlight).
  - **Order Board (theme-invariant):** sign-ink on sign 10.17; sign-price on sign **4.72** (5.58 on the sheen), so the price clears 4.5 even though display-xl only needs 3. plaque-ink on plaque 5.47.
  - **Sea bands:** ink on sea-top 11.57 \| 10.39; on sea-bot 7.98 \| 13.69. ink-muted on sea-top 5.25 \| 6.35 (inner-page band only; never on --sea-bot, where light mode drops to 3.62). ink on porthole glass 10.80 \| 8.44.
  - ink on slip 14.97 \| 12.09; ink-muted on slip 6.79 \| 7.39.
  - map-label on map-land 5.91 \| 7.75.
- **UI and graphics pairs (need 3 or more):**
  - line-strong on surface 4.09 \| 4.04; on bg 3.62 \| 4.59; on surface-2 3.38 \| 3.44.
  - focus on bg 6.40 \| 8.60; on surface 7.22 \| 7.57; on surface-2 5.98 \| 6.44; on slip 6.78 \| 6.88; on sign 5.03 (light-mode ring value, used inside the board in both themes). In atmosphere zones the ring is measured against `--focus-halo`: 7.22 \| 8.60 (see Focus ring). Without the halo, blue on a wood grain line falls to 2.84, which is why the halo exists.
  - ok-icon on ok-bg 5.47 \| 7.23; err-icon on surface 7.21 \| 6.11. highlight-edge on highlight-tint 4.50 \| 5.77. bar on surface 4.61 \| 4.90.
  - pin-ring on map-land 5.30 in light. In dark, every pin fill clears 3:1 against the land by itself (lowest 3.68), so the ring only separates overlapping pins.
- **Decorative, no minimum:** `--line`, `--grid`, `--axis`, rope, planks, brass, nails, net, caustics, bubbles, foam, awning, slip rule and margin, plaque and frame edges. None of them may carry text or mark an input boundary.

### Price ramp (cheap → expensive): "Shallows to Trench"
A sequential, **single-hue** sea ramp: aqua shallows fade into deep navy, lightness falling in even steps. **The deeper the water, the pricier the burger.** Bins are measured against the **citywide** `stats.index_median` (m), never a filtered subset, so a pin keeps its color when filters change. The rule, the thresholds, the keys (`steal | deal | going | pricey | splurge`) and the **names are unchanged** (`web/src/lib/price-bins.ts` keeps its logic; only the header comment's ramp name changes).

| Step | Name | Rule | Light | Dark | vs --surface (L \| D) | vs --map-land (L \| D) |
|---|---|---|---|---|---|---|
| --price-1 | Steal | p ≤ 0.70m | #54C2C7 | #C4FBF9 | 2.04 \| 13.65 | 1.66 \| 13.01 |
| --price-2 | Deal | 0.70m < p ≤ 0.85m | #2EA0B0 | #82DFE9 | 2.98 \| 10.08 | 2.44 \| 9.62 |
| --price-3 | Going rate | 0.85m < p < 1.15m | #197F94 | #5AC3D7 | 4.48 \| 7.53 | 3.66 \| 7.18 |
| --price-4 | Pricey | 1.15m ≤ p < 1.30m | #005F78 | #39A5C3 | 6.94 \| 5.41 | 5.67 \| 5.16 |
| --price-5 | Splurge | p ≥ 1.30m | #00405A | #1689B0 | 10.73 \| 3.86 | 8.77 \| 3.68 |

- **Validated** with the dataviz `validate_palette.js --ordinal`, both modes pass every check: lightness monotone (light OKLCH L 0.753 → 0.350, dark 0.950 → 0.589), adjacent ΔL ≥ 0.084 (floor 0.06), light-end contrast 2.04:1 (light) and dark-end 3.86:1 (dark), single hue (34° spread, limit 40°).
- **CVD:** worst adjacent ΔE 10.0 (deutan) in light and 8.5 (protan) in dark, both above the old heat ramp's 7.7. Cheap is palest and pricey is darkest in both modes, so the legend reads the same way day and night.
- **Secondary encoding stays mandatory:** every colored mark has its bin name and dollar range in the legend, its position in the histogram, and its price in the tooltip, chip and table row. The legend always prints both forms, for example "Steal · ≤ $15.36 (−30%)", with dollar thresholds computed from m. The light "Steal" step sits on the 2:1 floor, so chip stripes, legend buoys and histogram bars carry the 1px `--swatch-ring` and map pins the 1.5px `--pin-ring`. On a bar the ring is inset by half its width, so the bar's height is exact; over the pale Steal fill it measures 4.21 against the card (bare Steal: 2.04).

### Borough palette: "Harbor flags" (categorical, fixed order: never cycled, never re-sorted)
| Borough | Light | Dark | vs surface (L \| D) | vs bg (L \| D) |
|---|---|---|---|---|
| Manhattan | #005BB3 | #3584DE | 6.41 \| 4.06 | 5.68 \| 4.61 |
| Brooklyn | #AB3B79 | #C04D8B | 5.56 \| 3.45 | 4.92 \| 3.92 |
| Queens | #018C3F | #33AC5A | 4.18 \| 5.30 | 3.71 \| 6.02 |
| Bronx | #734DBE | #8465D0 | 5.71 \| 3.50 | 5.06 \| 3.98 |
| Staten Island | #BF5A0C | #D8691F | 4.31 \| 4.39 | 3.82 \| 4.99 |

- **Changes from the previous palette:** Staten Island moves from teal to **buoy orange**, so no borough shares the sea ramp's hue family. Brooklyn and Bronx get lighter dark-mode steps, because the navy surface is lighter than the old near-black one.
- **Validator, adjacent pairs:** light passes (worst CVD ΔE 8.8 deutan Queens↔Brooklyn, worst normal-vision 23.9, all ≥ 3:1 on surface); dark passes (worst CVD 10.9, normal-vision 23.7, all ≥ 3:1). **All-pairs** still fails on Manhattan↔Bronx (ΔE 2.1–2.4 under CVD), as before. The rules that follow:
  - Borough colors are for identity only, as a 10px key dot beside the borough name in rankings, the borough page header, the home page's borough links, borough filter chips and legends.
  - Never in a scatter or on the map, never next to ramp colors in the same chart, never without the text label.
  - On a sea band (the borough page header), the dot sits inside a 2px `--surface` ring, because dark Brooklyn and Bronx fall to 2.69 and 2.74 on `--sea-top`.

## Data visualization rules
Every rule of the data desk stands. The costume comes off inside the figure.
- **Charts stay honest: nothing from the building goes inside a plot.** No planks, rope, net, caustics, bubbles, brass, icons, drop shades or block shadows in a plot area, axis band, legend swatch or on the map canvas. No 3D, pies, dual axes, area-of-circle encodings, pictograms ("burger stacks", "wave heights") or dashed gridlines. The chart card (the "menu card") may have its thick border and block shadow; the plot inside is flat `--surface`.
- **Form:** The headline is a board, not a chart. Use a histogram for the distribution, horizontal bars for the five boroughs, and a dot-and-range plot for neighborhoods.
- **Chart card:** `--surface`, 2px `--line` border, radius 16px, `--shadow-block`, padding 16px (24px at `md`). The figure title, takeaway and "View as table" toggle sit above the plot in UI type. The kicker and rope rule belong to the section, outside the card.
- **Histogram (index prices):** Bins are $1 at ≥768px and $2 below that. The domain runs p1 to p99, with end bins labeled "≤ $X" and "$Y+". Each bar is filled with the `--price-n` of its bin midpoint, so the histogram doubles as the map legend. Leave a 2px `--surface` gap between bars. Round the data end with radius `min(4px, barWidth/3)` and keep the baseline end square. Each bar carries the 1px `--swatch-ring`, inset by 0.5px (bars under 3px wide go without). The plot is 240px tall on mobile and 320px on desktop, plus a 26px label band above and a 32px x-axis band below, so the chart never scrolls internally.
- **Axes:** No y-axis line. 3–5 clean y ticks with solid 1px `--grid` gridlines and a solid 1px `--axis` baseline. X ticks every $5 (`$15`). Tick labels are num-s in `--ink-muted`. Never dashed (the rope rule is not a chart rule).
- **Median annotation:** A 2px `--ink` vertical line through the plot. Its label sits in the label band above the plot: a 14px anchor icon, then "NYC median $21.95" (ui-s 600, `--ink`). The anchor is text decoration in the label band; it never marks a data position and never enters the plot. At most two more annotations per chart, in ui-s `--ink-muted` with a 1px `--axis` leader. Text never uses a data color.
- **Borough bars:** Bars start at $0, sorted high → low, 20px thick in 36px rows, filled with `--bar` (driftwood), square at the baseline and 4px-rounded at the tip. The hovered borough gets `--ink`. The value goes at the bar tip (num-m, `--ink`). The citywide median is a 1px `--ink` reference line labeled "NYC". The borough key dot sits beside the name. The chart is drawn on the home page only (`#boroughs`, which replaced the `/boroughs` index); under its card, the five borough pages are secondary buttons, each with its key dot, in the fixed borough order.
- **Neighborhood plot:** A 10px `--ink` dot marks the median, with a 2px `--axis` line from `index_min` to `index_max`. Rows are 28px and sorted by median. Only areas with **5 or more distinct priced menus** are ranked (`MIN_RANKED`; a chain counts once per area, so five 7th Street Burgers are one menu); the rest are listed under "Other neighborhoods" (the threshold is never stated on the site). An area priced only from chain menus is treated like any other.
- **Minimums:** Don't draw a histogram with fewer than **20 distinct priced menus** in the slice (`MIN_HISTOGRAM`). Show the empty state instead.
- **Counting unit:** Histograms, typical ranges, rankings, cheapest/priciest lists and every threshold count distinct menus (menu key = chain, else restaurant). Map pins, restaurant pages and table rows count locations, and any location count in copy says "locations" (or "pins").
- **Tooltips ("order tickets"):** `--surface`, 1.5px `--line` border, radius 10px, `--shadow-pop`, padding 8×12. The value comes first ("142 menus", ui-m 700), then context ("$15.00–$15.99 · Going rate", ui-s `--ink-muted`), with a 12×3px line key in the mark's color. The same content appears on keyboard focus: a chart is one tab stop, and ←/→ move between marks. Hit targets are at least 24px, larger than the mark. Insert labels with `textContent`.
- **Text alternative:** Every chart is a `<figure>`. The `<figcaption>` holds a title plus a one-sentence takeaway ("Most of these 565 index prices fall between $12 and $28; the median is $19.95."). The takeaway states what the data shows, never how it was counted or computed. The SVG gets `role="img"` and `aria-labelledby` pointing at them. A "View as table" button swaps in a real `<table>` of the same numbers (its label flips to "View as chart", so it takes no `aria-pressed`). The chart's area names are pointer-only links inside the image; the table's row headers are the keyboard-reachable links to each borough and neighborhood page.
- **Filter changes:** Charts keep their previous frame at 50% opacity until the new data renders. No skeletons, no layout jump.
- **Empty state:** see Components → Empty states, at the chart's height.

## Spacing, Layout, Surfaces
- **Spacing (4px base):** --space-1 4, -2 8, -3 12, -4 16, -5 24, -6 32, -7 48, -8 64, -9 96. Major sections are 48px apart on mobile and 96px on desktop. Each opens with the rope rule, then 16px, the kicker, 8px, and the H2.
- **Breakpoints (mobile-first):** base 375–639, `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The page never scrolls horizontally at 375px (all three proposal mocks measured `scrollWidth` 375). Set `min-width: 0` on flex and grid children, `overflow-wrap: anywhere` on names and URLs, and `overflow-x: clip` on every band that holds decoration that may overhang (hero, shallows band, board rig, awning).
- **Grid:** 4 columns with 16px gutter and margins at base. 8 columns with 24px gutter and margins at `md`. 12 columns with 24px gutter and 32px margins at `lg`.
- **Max widths:** content 1200px (`--max-page`), prose 680px (`--max-prose`), map full-bleed up to 1440px.
- **Nav height:** `--nav-h: 64px` (56px of planks plus the 8px rope trim). Sticky table headers use `top: var(--nav-h)`. The awning is **not** sticky, so it never adds to the offset.
- **Page anatomy:** nav (sticky) → awning (30px) → home: hero window band, wave edge; inner pages: shallows band with page header → sections on `--bg` → footer deck.
- **Radii (rounder, cartoon):**
  - --radius-1 4px: swatches.
  - --radius-badge 6px: source badges and the "Live" badge.
  - --radius-2 8–12px: price chips 8px; inputs, buttons, icon buttons and tooltips 10–12px.
  - --radius-3 16–18px: cards, chart cards, stat tiles, table shell, legend plaque, empty states, board frame (18px; the face inside is 10px).
  - --radius-pill 999px: filter chips, porthole theme toggle, key dots.
- **Borders:** cards and chart cards 2px `--line`; interactive boundaries (inputs, filter chips) 1.5–2px `--line-strong`; badges 1.5px `--line-strong`; price chips 1.5px `--line`; stat tiles and the legend plaque 3px `--brass`; table-header bottom rule 2px `--line-strong`; table row dividers 1.5px `--line`.
- **Shadows:**
  - `--shadow-block: 0 4px 0 var(--block)`: cards, chart cards, stat tiles, table shell, legend plaque, the hand-check slip.
  - Button press shadows: `0 4px 0 var(--accent-deep)` (primary) and `0 4px 0 var(--ink)` (secondary), dropping to `0 1px 0` when pressed.
  - `--shadow-pop`: tooltips, popovers and sheets only. Light `0 1px 2px rgba(43,27,16,.08), 0 8px 24px rgba(43,27,16,.14)`; dark `0 8px 24px rgba(0,0,0,.55)`.
  - `--shadow-sign: 0 24px 30px -16px rgba(43,27,16,.55)` (dark `rgba(0,0,0,.7)`), plus `--sign-glow` at night: the hanging board only.
  - Data marks never get a shadow.

### Textures (each is CSS or inline SVG; no image files)
| Name | Built from | Used on | Rules |
|---|---|---|---|
| **Plank** | An inline SVG data-URI tile, 360×56, alpha-only strokes over `background-color: var(--wood-face)` (nav) or `var(--deck)` (footer), so one tile serves both themes: a 1px top highlight (white 18%), a 1px bottom seam (black 25%), three grain curves (`M0 14C60 11 120 17 180 14S300 11 360 15` and two like it at y 28 and 41; black 6–7%), one knot ellipse (rx 9, ry 3.5, black 10%), one butt joint at x 244.5 (black 12%) with four nail heads (r 1.8, black 12%) | Nav, footer; a 6%-alpha copy of the grain on the table header | Any stroke that can fall behind text stays ≤12% alpha (measured worst cases are in the contrast list). The nav uses one tall plank per row, so its 25% seam never crosses text. The footer deck repeats the tile under running text, so it has its own copy with the highlight at 8% and the seam at 12% |
| **Rope** | `repeating-linear-gradient(118deg, var(--rope-1) 0 4px, var(--rope-2) 4px 6px, var(--rope-1) 6px 8px)`, 8px tall, radius 4px, `box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px 0 rgba(0,0,0,.25)`. Vertical hangers use 28° at 6px wide | Section rules, nav bottom trim, footer top rail, board hangers, map frame top edge, bottom-sheet top edge | `aria-hidden` |
| **Trap net** | `repeating-linear-gradient(45deg, var(--net) 0 1.5px, transparent 1.5px 18px), repeating-linear-gradient(-45deg, var(--net) 0 1.5px, transparent 1.5px 18px)` | The 404 page, the margin around empty-state art | Never behind text; tiles on it are opaque |
| **Awning** | `repeating-linear-gradient(90deg, var(--awning-a) 0 36px, var(--awning-b) 36px 72px)` on a 30px bar, masked by `linear-gradient(#000 0 0) top/100% 12px no-repeat, radial-gradient(circle 18px at 18px 12px, #000 17.5px, #0000 18px) 0 0/36px 30px repeat-x` (one 18px-radius scallop per stripe). `filter: drop-shadow(0 3px 0 rgba(0,0,0,.2))` goes on a **wrapper**, because a filter on the masked element itself would be masked away | Under the nav on every page, overlapping the band below by its own height | Decorative, `aria-hidden` |
| **Caustics** | An inline SVG `<pattern>` 132×30 holding one stroke `M0 15 Q33 5 66 15 T132 15` (2px, `--caustic`), filling a 140px band masked by `linear-gradient(#000, transparent)` | Top of the home hero water; top of the inner shallows band at 60% opacity | Fades out before the lede; never animated |
| **Bubbles** | `span` circles 6–14px: `border: 2px solid var(--bubble); border-radius: 50%; background: radial-gradient(circle at 32% 30%, rgba(255,255,255,.9) 0 18%, transparent 22%)` | Inside the home hero's left and right page gutters only; empty states (at most three, static) | Never over text; rise once (see Motion) |
| **Wave edge** | Inline SVG 1440×40, `preserveAspectRatio="none"`, path `M0 20C240 0 480 40 720 20S1200 0 1440 20V40H0Z` filled `var(--bg)`, plus the same curve stroked in `--foam` with `vector-effect: non-scaling-stroke` | Bottom edge of the home hero and of the inner shallows band | Decorative |
| **Shallows band** | `linear-gradient(180deg, var(--sea-top), var(--bg))` behind the page header, padding 32px (48px at `md`) top, 40px bottom, then the wave edge | Every inner page's header (breadcrumbs, kicker ticket, H1, lede) | Text on it is `--ink` or `--ink-muted` only (checked against the worst stop, --sea-top); no bubbles, no blossoms |
| **Brass rim + rivets** | `border: 3px solid var(--brass); box-shadow: inset 0 0 0 1.5px var(--brass-hi), var(--shadow-block)`; four rivets as `radial-gradient(circle at 10px 10px, var(--brass-lo) 0 2.2px, transparent 2.6px)` repeated at each corner, layered over `var(--surface)` | Stat tiles, the map legend plaque | Decorative |
| **Porthole** | A circle: `background: radial-gradient(circle at 35% 30%, var(--glass-hi), var(--glass) 70%)`, `border: 4px solid var(--brass)`, `box-shadow: 0 0 0 1.5px var(--brass-lo), inset 0 2px 4px rgba(0,0,0,.25)`; icon inside in `--ink` | Stat-tile badge (42px), theme toggle (40px), 404 art | Icon on glass 10.80 \| 8.44 |
| **Sign face** | `radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,.35), transparent 60%), var(--sign)` with `box-shadow: inset 0 0 0 2px rgba(58,31,12,.25)` | Order Board face, OG image (flat `--sign` there) | The price stays on yellow (4.72 flat, 5.58 on the sheen) |
| **Guest-check slip** | `repeating-linear-gradient(180deg, transparent 0 27px, var(--slip-rule) 27px 28px), var(--slip)`; a red double margin line as a `::before` at left 24px (`border-left: 1.5px solid var(--slip-margin)` plus `box-shadow: 3px 0 0 -1.5px var(--slip-margin)`); a torn top edge as `radial-gradient(circle 3px at 6px 3px, var(--bg) 97%, transparent) 0 0/12px 6px repeat-x` layered on top | The hand-check note | Slip text sits at line-height 28px on the rules |

## Components
- **The Order Board** (headline price; restyles `Letterboard.tsx` with the same props, keeps `BoardSeenMarker`):
  - **Rig** (all `aria-hidden`):
    - A 16px `--frame-2` **beam** runs the board's full width, with two brass bolts.
    - Two 6px rope **hangers** at 15% from each edge, each ending in a 16px brass eyelet at the frame top. The board hangs 40px below the beam.
    - An **"ORDER UP!" plaque** centered on the frame's top edge (translateY −50%, rotate −2°): `--plaque` fill, `plaque` type in `--plaque-ink`, padding 6×14, radius 6px, `box-shadow: 0 0 0 2px var(--nail), 0 3px 0 2px var(--nail)`, two 4px `--brass` rivet dots. It sits between the ropes and never overlaps them at 375px.
    - An **order-up bell** (28px, 36px at `md`) sitting on the beam at its right end, drawn in `--brass` with a `--brass-lo` outline.
    - A **life ring** (52px, 64px at `md`) hung off the lower-left corner at left/bottom −16px (−20px at `md`), rotated −14°.
  - **Frame:** 12px (16px at `md`) of `--frame-1` with faint grain, four nail heads, radius 18px, `--shadow-sign`, plus `--sign-glow` at night.
  - **Face:** the sign face, radius 10px, padding 22px 18px 40px (mobile) and 30px 36px 44px (`md`). The larger bottom padding keeps the last text line clear of the life ring. Everything on the face is centered, like a painted order board and the OG image.
  - **Content, top to bottom** (unchanged from the Letterboard):
    - A `label` overline in `--sign-ink`: "THE BURGER INDEX · NYC MEDIAN".
    - The price in display-xl `--sign-price` with `text-shadow: .022em .03em 0 var(--sign-shade)`, and price-card cents (underline in `--sign-price`).
    - A ui-m `--sign-ink` line: "565 menus · Updated Sep 24, 2026". Each part wraps as a unit. It carries no index-price rule and no coverage part (both removed 2026-09-25 with the other methodology copy).
  - **Behavior:** Yellow in both themes; at night it glows. Glyph spans are `aria-hidden`, with one sr-only "$21.95", and the `<figure>` has `aria-label` "The Burger Index, NYC median: $21.95". The board holds no focusable element.
  - **Placement:** At most one per page: the home hero, and the header of a ranked borough or neighborhood page (an unranked area gets none). On home it spans columns 6–12 at `lg` and sits under the H1 on mobile. Its line is the only place a page states its menu count.
- **Hero kicker ticket:** An inline-flex tag above the H1: `--accent` fill, `kicker` type in `--accent-ink`, 28px tall, padding 0 12px, radius 6px, `0 3px 0 var(--accent-deep)`, with a 16px bell icon. On any sea band, kickers always use this ticket form, because plain `--accent` text falls to 4.08 \| 4.32 on `--sea-top`.
- **Stat tile ("porthole tile"):**
  - Brass rim and rivets on `--surface`, radius 18px, padding 30px 14px 14px, `--shadow-block`.
  - A 42px porthole badge sits over the top-left rim (top −21px, left 14px), holding an 18px icon: borough and neighborhood tiles → ship's wheel; the People's Price tiles → scales, anchor and order bell.
  - Content: the `label` in `--ink-muted`, then the value in `stat` (price-card cents for money; a range like "$9.15–$29.40" wraps as a unit, never between the dash and a price), then a ui-s `--ink-muted` sub-line.
  - Grid: two per row on mobile (row gap 36px so the badges clear), four at `md` (fewer tiles leave the row's end empty; the People's Price page uses three columns). Each tile is a three-row subgrid (label, value, sub-line), so the values in a row line up even when one label wraps. Money values take their baseline from the whole dollars, so "$16.50" sits level with a plain "80".
  - **Borough and neighborhood headers** (`components/AreaStats.tsx`) show the area's median once and its vs-NYC once: a ranked area's board carries the median, so its tiles are "vs NYC" (sub-line "NYC median $20.00") and "Range" ("$10.00–$26.00", sub-line "Cheapest to priciest index price"; one price: "One priced menu" or "Every index price here is the same"); an unranked area adds "Median" (sub-line "Index price") first. The home page has no tiles (the typical range is the spread section's H2).
- **Price chip ("price tag"):**
  - Inline-flex, 28px tall, padding 0 10px 0 8px, `--surface`, 1.5px `--line` border, radius 8px.
  - A **6px full-height `--price-n` stripe** on the left edge (`border-left: 6px solid var(--price-n)` plus `box-shadow: inset 1px 0 0 var(--swatch-ring)`), then the price (num-m `--ink`, no suffix), then the delta (num-s `--ink-muted`: "+78% vs NYC", or "at median" when |Δ| < 0.5%). `title` gives the bin name.
  - The stripe (not a round dot) keeps round marks for map pins and borough dots only. Deltas are never red, green or sea-colored. Under 360px the delta may wrap inside the chip.
- **Data table ("the ticket rail"):**
  - The shell has a 2px `--line` border, radius 16px, `--surface` and `--shadow-block`. It uses `overflow: clip`, not `hidden`, so the sticky header still works.
  - **Header:** sticky at `top: var(--nav-h)`, 42px, `--surface-2` with the plank grain at 6% alpha, `label` type in `--ink-muted`, and a 2px `--line-strong` bottom rule. Sortable headers are buttons with `aria-sort` and an arrow icon. Below `sm` the header labels wrap (the clipped shell can't scroll sideways, and a nowrap header pushed the last column out of it at 320px); below 360px cell padding drops to 8px. Links and buttons in the body get `scroll-margin-top: 54px`, so Shift+Tab never parks focus under the sticky header.
  - **Rows:** at least 48px, 1.5px `--line` dividers, `--surface-2` on hover, 16px cell padding-x.
  - **Columns:** numeric columns (Price, vs median, counts) are right-aligned tnum; Price is the price chip. Delivery-app prices carry no dagger and no footnote; the source badge says "Delivery app".
  - **Explorer rows: one per priced restaurant, led by the restaurant:** the first column is the restaurant name (ui-m 600, the row's title, linking to its page), then "neighborhood · borough" (ui-s muted) and the source badge; the Burger column holds the burger's name as plain text (the restaurant link is the row's one link).
  - **Below `sm`:** two columns. The left cell holds the restaurant name (ui-m 600), the burger name under it, "neighborhood · borough" (ui-s muted) and the source badge. The right cell holds the price chip.
  - **Paging:** "Haul in 100 more" with "Showing 100 of 4,812". Never infinite scroll.
- **Filter bar:** one row above everything it scopes: the search and Sort, then Borough (multi-select), Neighborhood (a select of the neighborhoods with a priced restaurant) and Price (Min and Max inputs plus the five Steal-to-Splurge presets). Nothing else: no protein, source or index-only filter (removed 2026-09-25), and their old URL parameters are ignored.
  - **Filter chips ("buoys"):** 34px pill, 1.5px `--line-strong`, ui-m, `--surface`, with a 44px hit area. The **active** chip is `--accent` with `--accent-ink` text, a `--accent-deep` border and a 2px press shadow, plus an × and an sr-only ", remove filter". Borough chips carry their flag dot with a 1.5px `--surface` ring, active ones included. A "Clear all" ghost button follows. In the desktop popovers the options are checkboxes drawn in the chip's colors: 20px, radius 6px, a 2px `--line-strong` border on `--surface`; checked is `--accent` with an `--accent-deep` border and an `--accent-ink` check (never the browser's default box).
  - **Below `md`:** search plus a "Filters (n)" button (ship's-wheel icon) that opens a bottom sheet: `--bg`, a rope top edge, the kicker "Your order" over the heading "Filters", the Borough group as wrapping buoy chips (`aria-pressed` toggle buttons under a visible legend, row gap 10px so the 44px hit areas never overlap) that never scroll sideways, the Neighborhood select and the Price group, and a primary "Show 142 burgers" button.
- **Search input ("spyglass counter"):**
  - 48px tall, `--surface`, 2px `--line-strong`, radius 12px, a 20px magnifier icon inset 14px, ui-l text. A visible `label` above it reads "Search every burger".
  - Placeholder: "Search burgers, restaurants, neighborhoods", shortened to "Search burgers, restaurants" below `sm` (measured: the long one needs 308px at 16px Barlow; the input leaves about 290px at 375px).
  - A clear × shows when filled. `/` jumps to the input while focus is anywhere inside the explorer (filters, chips, results), never page-wide, so a single-key shortcut can't fire from elsewhere (WCAG 2.1.4); the hint shows at `lg`. Matches are wrapped in `<mark>` with a `--highlight-tint` background.
- **Cards ("menu cards"):** restaurant cards on mobile results and the cheapest/priciest callouts. `--surface`, 2px `--line`, radius 16px, padding 16px, `--shadow-block`. The whole card is clickable through a stretched link on the name. On hover the border goes to `--line-strong` and the card lifts 2px (shadow grows to 6px); under reduced motion only the border changes. Callouts carry a kicker ("Cheapest on the counter" / "Top shelf").
- **The burger block** (restaurant pages; `id="burger"`): the one burger the page is about, right under the header, as a `panel` card (max 48rem, padding 16px, 24px at `md`). A data zone: no decoration.
  - The heading "The burger" (an H2 in `label` type, `--ink-muted`).
  - One menu line: the burger's name (display-s), a rope-colored dotted leader (`border-bottom: 2px dotted var(--line-strong)` flex filler), then the price in `stat` type with price-card cents. The description sits below in body-s `--ink-muted`.
  - Under a 1.5px `--line` rule, two facts side by side: "vs {neighborhood}" and "vs NYC" (`label`), each a delta in num-l ("+38%", "−3%", "at median") over a ui-s muted sub-line ("Neighborhood median $16.00", "NYC median $20.00"). The neighborhood fact is left out when the neighborhood has no other priced menu.
  - The source badge, once.
  - Under the card, a ui-m row of links: "Menu page: host ↗", "Website: host ↗" (external, new tab, each only when on file) and "See it on the map" (map-pin icon, to `/map?r=<id>`, which opens the map on that pin; only when the restaurant has coordinates). No mini map: MapLibre never loads on a restaurant page.
- **Source badges:** 24px, radius 6px, `--surface` fill, 1.5px `--line-strong` border, Barlow 500 12px `--ink-muted`, a 14px lucide icon at `strokeWidth={2}`. Labels unchanged:

  | Value | Label | Icon |
  |---|---|---|
  | official_site | Restaurant site | Globe |
  | official_pdf | Menu PDF | FileText |
  | online_ordering | Online ordering | ShoppingBag |
  | menu_aggregator | Menu aggregator | BookOpen |
  | delivery_app | Delivery app | Bike |

  The **delivery_app** badge uses a `--highlight-tint` background, a `--highlight-edge` border and `--ink` text. No badge has a tooltip, and no delivery-price note goes with it anywhere on the site. A restaurant page shows it once, in the burger block.
- **Pages only for priced places (user decision, 2026-09-25):** a restaurant without a price (no menu found, no beef burger, no price online, a failed scrape, a withheld price) has no page, no sitemap URL and no row in the explorer, the map, the map's "Not on the map" list or a chain list. It appears only as a plain name on its neighborhood's page, under the `label` heading "Not priced" (three columns from `lg`, 44px rows, the street address after a name that repeats). A neighborhood with nothing priced has no page either: `/neighborhoods` lists it as a plain `--ink-muted` name with "not priced", and borough pages and "Elsewhere in …" lists leave it out. There are no status badges and no status copy.
- **Hand-check note ("the cook's correction slip"):** the restaurant's hand check (the dataset's `hand_check`, set by `pipeline/corrections.py`) is shown as its own card under the burger block's links, because it changes the price the page shows. It is a label only: it says that a hand check happened and when, never what was changed or why.
  - Shape: a guest-check slip at prose width (max 680px), radius 0 0 12px 12px (torn top), padding 14px 16px 14px 40px (the margin line sits at 24px), `--shadow-block`.
  - One label line, its only content (a `p`, not a heading, since nothing sits under it; `label` in `--ink-muted`, 16px ClipboardCheck icon): "Prices corrected by hand · Sep 23, 2026". The date never wraps.
  - No body, no reason and no chain line (the correction reasons and "they share one menu" were removed 2026-09-25).
  - A **withheld** price leaves the restaurant unpriced, so it has no page and no slip (its "Prices withheld after a hand check" twin went with the unpriced pages, the only place it could show). Scrape notes are not in the dataset.
  - The slip is the only place the check appears.
- **WorthPicker ("What would you pay?")** (`components/worth/WorthPicker.tsx`): on every restaurant page (only priced restaurants have one), after the burger block and the hand-check slip, a section with `id="worth"` (the boards link straight to it), the kicker "What's it worth?" (scales) and the H2 "What would you pay?". One `panel` card (max 48rem, padding 16px, 24px at `md`):
  - **Label** (ui-m `--ink`, the slider's visible `<label>`): "Your price for **Smash Burger**" (the burger name at 600).
  - **Readout:** the slider's value as a lone number in Lilita, 56px (72px at `md`), `--ink`, with the price-card "$" (half size, top-aligned) and no cents. `aria-hidden`: the slider announces its own value.
  - **Slider ("the rope and the lever"):** a native `<input type="range">`, $5 to $75 in $1 steps (whole dollars are the only way to answer), max 560px wide, 44px tall. The track is a 12px length of rope (the rope texture, radius 6px) with a 1.5px `--line-strong` edge (4.09 \| 4.04: the input boundary); the thumb is a 30px brass lever knob: `--brass` with a `--brass-hi` glint and a `--brass-lo` center rivet, a 3px `--brass-lo` rim (6.50 on surface in light; in dark the brass fill carries it at 4.04) and a `0 3px 0 var(--block)` block shadow. "$5" and "$75" (num-s muted) sit under the ends, 4px below the slider so its focus ring never crosses them. `aria-valuetext` reads "$29". Keyboard is the browser's own: ←/→ and ↑/↓ ±$1, Page Up/Down, Home/End. Focus: the standard 3px ring around the whole slider. Disabled: 40% opacity, no knob shadow.
  - **Start:** the visitor's saved answer, else the middle, **$40**. Never the menu price. Once the visitor moves it, a saved answer that loads late doesn't move it back. Until the saved answer is known (loading, or its load failed) the untouched slider can't be sent: "Order up!" stays disabled until the answer arrives or the visitor moves the slider, so an untouched $40 never replaces a saved answer.
  - **"Order up!" button:** the primary button at `lg` as an order ticket: a 2px dotted perforation (`currentColor` at 50%) 12px in from the left edge, the order bell (without its dings), then "Order up!". Dragging never sends an answer; the button (click, Enter or Space) does.
  - **Status line** (ui-s muted, `aria-live="polite"`, beside the button, wrapping under it on a phone): "Slide to your price, then order up." · "Sending your answer…" · "Saved: $29." · "Your answer: $29." · "Your answer: $29. Order up to change it." (moved, not sent) · errors with a 16px TriangleAlert in `--err-icon`: "Too many answers from this connection — try again in a bit." (rate limit) · "Couldn't reach the counter. Check your connection and try again." (network) · "That answer didn't go through. Pick a whole dollar amount from $5 to $75." · "Something went wrong saving your answer. Try again." · "Couldn't load your saved answer." (same icon) with a secondary `sm` "Try again" after it, which loads it again and moves focus to the slider.
  - **Behavior:** optimistic. An answer shows at once (in "Your answer" and in the distribution) and saves in the background; sends for one burger go one at a time, newest last, and the visitor's own answer is never counted twice. A failure falls back to the saved answer and says why. A visitor can change their answer any time. A chain's locations share one menu and so one People's Price; nothing on the page says so. A menu priced above $75 works the same, and nothing says the slider stops at $75. While the People's Price shows, it refreshes every 30 seconds while the tab is visible, and again when the visitor comes back to the tab, so other visitors' answers appear without a reload (a quiet refresh, no badge, no animation; not a realtime channel, which every page view would hold open).
  - **Screen readers:** the results aren't a live region, so a hidden polite live region in the card says what the crowd says once an answer is saved: "People's Price $26, 9 answers. Right on the money." (or "… Needs a few more answers."). Numbers and labels only.
  - Nothing loads (and the Supabase client isn't fetched) until the card is within about a screen of the viewport. Without the Supabase settings the slider and button are disabled and the status line says "Answers open soon."
- **People's Price summary** (inside the card, under a 1.5px `--line` rule): shown only once the visitor has answered; before that the People's Price stays hidden (no anchoring). A data zone:
  - A `<dl>` of three facts, each a `label` over a `stat` value: "People's Price" (whole dollars, `$29`) with "12 answers" (num-s muted) under it, "Menu price" (price-card cents, `$27.00`) and "Your answer" (`$29`). Three columns from `sm`; on a phone the People's Price takes its own row above the other two.
  - The **verdict** as a flat tag: 32px min, padding 4px 12px, radius 8px, `--surface-2`, 1.5px `--line-strong`, ui-m 700 `--ink`: "A bargain by 7%" · "Overpriced by 43%" · "Right on the money"; with fewer than three answers "Needs a few more answers" at weight 500 in `--ink-muted`. Never red or green, never an icon alone.
  - Then the answer distribution, then the link "See the People's Price board →".
  - Loading: two flat `--surface-2` skeleton blocks (no shimmer). Failed: "Couldn't load the People's Price." with a secondary "Try again".
- **Answer distribution** (`components/worth/AnswerSpread.tsx`): a compact histogram under the summary, a `<figure>` with the title "What people would pay" (ui-m 700), a takeaway that states the data ("Answers run from $12 to $45." / "Every answer is $29.") and the "View as table" ghost toggle (the table lists "Answer" ranges and "Answers" counts for the non-empty ranges, the visitor's marked "· yours").
  - Fourteen equal $5 bars, $5–$9 … $65–$69 and $70–$75, 2px apart, flat `--bar`, 4px-rounded at the top and square at the baseline, at least 2px tall when not empty, in a 72px plot (88px at `md`, max 560px wide) on a 1px `--axis` baseline. No y axis and no gridlines (the table carries the counts); x labels "$5 · $25 · $50 · $75" in num-s muted.
  - The bar holding the visitor's answer is `--ink` (the "current" rule), keyed under the plot with an ink swatch and "Your answer's range".
  - The **menu price** is a 2px `--ink` line through the plot with a 2px `--surface` halo on each side, so it still reads where it crosses the ink bar. Its label "Menu $27.00" (ui-s 600 `--ink`) sits in a 22px band above the plot, anchored start, middle or end so it never leaves the plot. A price off the axis (above $75, below $5) is pinned to the nearer end and its label still gives the real price.
  - The plot is one `role="img"` labelled by the title and takeaway. No tooltips, no animation, nothing from the building.
- **The People's Price page** (`/peoples-price`, `components/worth/PeoplesPriceBoard.tsx`):
  - **Header:** the shallows band with the ticket "What's it worth?" (scales), H1 "The People's Price.", lede "What visitors would pay for each burger, next to what the menu charges. Name your price on any restaurant page; the boards update live."
  - **Meta line:** a "Live" status badge (`--ok-bg`, an 8px static `--ok-icon` dot, never pulsing) while the realtime channel is up.
  - **Headline:** three porthole tiles on the counter: "People's Burger Index" (scales; whole dollars; sub-line "3 burgers"; "—" with "Needs a few more answers" once the answers have loaded and no burger has a verdict; "—" with a blank sub-line while loading, when answers are closed or when the answers couldn't be loaded), "The Burger Index" (anchor; the real index with cents; sub-line "Menu prices · 532 menus") and "Answers" (order bell; "11", sub-line "On 4 burgers"). The two indexes sit side by side for contrast; no sentence compares them.
  - **Boards** (each a section with the rope rule, a kicker and an H2, then a ticket-rail shell: `--surface`, 2px `--line`, radius 16px, `--shadow-block`, `overflow: clip`, holding an `<ol>`): "Good catch" (net) · "Biggest bargains." (verdict "a bargain", widest gap first); "Walk the plank" (anchor) · "Most overpriced." (widest gap first); "Talk of the dock" (order bell) · "Most answered." (every answered burger, most answers first). Exact ties share a rank (1, 2, 2, 4) and fall back to more answers, then name. The first 10 rows show, then "Haul in 10 more" with "Showing 10 of 24". Burgers without a verdict appear only in "Most answered" and "On the pass".
  - **Row:** rank (Barlow 700 20px tnum, right-aligned), the restaurant (ui-l 600 link to its page's `#worth` section) over "burger · neighborhood, borough" (ui-s muted; a chain shows "5 locations"), then Menu (`$27.00`, num-m), People's (`$29`, num-m), the verdict (ui-s 600; "Needs a few more answers" muted) and "3 answers" (num-s muted). From 1024px each row is a grid (44px, 1fr, 96px, 96px, 200px, 104px) under a `label` header row on `--surface-2` with the table-header rule (Rank, Burger, Menu, People's, Verdict, Answers), numbers right-aligned. Below 1024px the facts wrap under the name, each with its own `label`-style word ("MENU $27.00 · PEOPLE'S $29"); screen readers hear those words at every width. Rows are 1.5px `--line` apart, 14px × 12px padding (16px from `sm`).
  - **"On the pass"** (spatula) with the computed H2 "1 burger needs a few more answers.": answered burgers without a verdict as a compact list (two columns from `sm`: the name link over the burger, "2 answers" at the right, 48px rows), 12 then "Haul in 12 more".
  - **"Name your price"** (spyglass) · "Find a burger.": a search input labelled "Find a burger", placeholder "Restaurant, burger or neighborhood", listing up to 8 matching burgers as unranked rows ("No answers yet" when none; "Showing 8 of 23 matches"; none: "No burgers match “truffle”. Nothing in the net; try another name."), each linking to its slider.
  - **States:** five flat skeleton rows while loading; "Nobody has named a price yet. Be the first." with a primary "Find a burger" (it focuses the search) when nobody has answered; "No bargains on the board yet." / "Nothing overpriced on the board yet." for an empty board; "Couldn't reach the counter. Check your connection and try again." with "Try again" if the first load fails; "Answers open soon." without the Supabase settings.
  - **Live:** the page loads the public answer histograms of the dataset's menus only (never the rest of the table), subscribes to their changes and recomputes every People's Price, verdict and board in the browser as they change, falling back to a refresh every 30 seconds while the channel is down, and unsubscribes when the visitor leaves. Changes for burgers the dataset doesn't know are dropped; a chain is one entry.
- **Map pin and legend:**
  - **Pins ("buoys"):** a circle filled with `--price-n` and a 1.5px `--pin-ring`. Diameter 8px below zoom 12 and 12px at zoom 12 and above. Hover or select grows it to 16px with a 2px `--ink` ring on top. Hit target 24px, no clustering.
  - **Draw order:** sorted by a hash of the id, so neither end of the ramp buries the other.
  - **Legend ("depth chart" plaque):** a brass-rimmed `--surface` card in the top-left, radius 16px. Title `label`: "Depth chart · index price". Five rows, each with a 14px round buoy swatch (with `--swatch-ring`), the name (ui-m 600), the $ range (num-m) and the % range (num-s muted), in cheap → pricey order. It ends with the note "Colors vs NYC median $21.95. The deeper the water, the pricier the burger." It prints pin counts when counts are shown, and collapses to a "Legend" button below `md`.
  - **Basemap:** sand land, desaturated slate water, parks, borough borders and neighborhood labels (`label` in `--map-label`) only. No POIs, no business names, no nautical ornament on the canvas.
  - **Frame:** the map frame gets a rope top edge. Text on the map always has a `--surface` backing.
  - **List fallback:** a list-view toggle sits beside the map, because a map is never the only way to reach a restaurant.
- **Nav ("the facade"):**
  - 64px sticky: planks on `--wood-face` plus the 8px rope trim. The wordmark is the life-ring emblem (30px; 26px below `sm`; `aria-hidden`) followed by "THE BURGER INDEX" in the `wordmark` type, `--wood-ink`. The small "THE" keeps a real space after it (the text reads "The Burger Index"). The home link's `aria-label` is "The Burger Index, home". In the header the wordmark may wrap to two lines rather than run under the search button, and below 360px it steps down to 17px.
  - **Links:** Index · Burgers · People's Price · Map · Neighborhoods (the `NAV` list in `lib/site.ts`; Boroughs left on 2026-09-25, when `/boroughs` folded into the home page), Barlow 600 15px, padding 0 12px (0 10px at `lg`). The active link is a **red plank tab**: `--accent` fill, `--accent-ink` text, radius 9px, a 3px `--accent-deep` press shadow, plus `aria-current="page"`. Restaurant pages mark Burgers and borough pages mark Index. Hover gets a `--wood-hover` fill.
  - **Right side:** the search icon button (magnifier, 40px with a 44px hit area) and the theme toggle. The toggle's text label shows at `xl` only (measured with the former six-link nav: with the label the bar needed 965px, 5px more than `lg` offers). Both labels share one grid cell and the inactive one is `visibility: hidden`, so the toggle keeps one width and the links don't shift on a theme change.
  - **Below `lg`:** wordmark, search, theme toggle (from `sm` up) and a "Menu" button: a ship's-wheel icon with the visible word "Menu" (a wheel alone is not a recognizable menu icon), padding 0 10px. The wheel turns 45° on hover. It opens a full-height sheet on `--bg` with a rope top edge: links as 56px rows in display-s with a dotted menu leader and a nautical icon at the end of each row, the theme toggle, and a close ×. The current page's label is the same red plank tab as the desktop nav (a filled shape, not a color change alone).
  - **Below `sm`:** the header holds the wordmark, search and Menu; the theme toggle moves into the sheet (measured: 330px of 343px at 375px).
- **Awning:** under the nav on every page (see Textures), `aria-hidden`, not sticky.
- **Page header (inner pages):** the shallows band holds breadcrumbs (ui-s `--ink-muted`, "/" separators), the kicker ticket, the H1 (display-l `--ink`) and the lede (max 680px, `--ink`). Top-level pages use the kicker ticket. Detail pages use one overline form instead: a `label` line in `--ink-muted` naming the page type: "Borough", "Neighborhood · ● Manhattan" (ringed dot), "Restaurant" (no cuisine). Borough pages put the flag dot (in its 2px `--surface` ring, scaled to 0.3em) before the H1. A restaurant page's lede is its address ("124 Bedford Avenue, Williamsburg, Brooklyn.", no ZIP) and its header holds no badge. A ranked area's header has no lede (the board carries its median and menu count); an unranked one's lede is its counts. The "Boroughs" breadcrumb goes to `/#boroughs`. Any price chip or badge in the band has its own `--surface` fill. With a board beside it at `lg`, the header column is top-aligned under the breadcrumbs and the board hangs beside it.
- **Section heading:** rope rule, 16px, kicker (`--accent` Lilita with an 18px icon, on `--bg` or `--surface` only), 8px, H2 (display-m, the computed data sentence), then an optional body `--ink-muted` description (max 40em). The kicker is optional, at most one per section, and never the only thing that says what the section is.
- **Footer ("the deck"):** the rope rail, then deck planks, padding 44px, three columns (one on mobile):
  - Data: the wordmark in `--deck-ink`, the data line "Updated Sep 25, 2026" (no menu count: it is on the board line), and "Prices in US dollars, before tax and tip." (ui-s `--deck-muted`).
  - Links: the nav links and "Use system setting", in `--deck-ink`, underlined. There is no data download (removed 2026-09-25).
  - Disclaimer (body-s `--deck-muted`): "We index prices, not quality. An original seaside-diner homage: not affiliated with any restaurant, TV show or network." Then "Map data © OpenStreetMap contributors, tiles by OpenFreeMap." (the tile and OSM license attribution). No sign-off and no source credit for the restaurant list.
- **Buttons (chunky):** sizes sm 32 / md 40 / lg 48px tall, padding-x 12/16/20, Barlow 700 at 14/14/16px, radius 12px, a 2px border, and a 44×44 minimum hit area.
  - **Primary:** `--accent` fill, `--accent-deep` border and press shadow, `--accent-ink` text, `--accent-hover` on hover.
  - **Secondary:** `--surface` fill, a 2px `--ink` border, `--ink` text, a 4px `--ink` press shadow, `--surface-2` on hover.
  - **Ghost:** `--ink-muted` text, underlined, turning `--ink` on hover.
  - **Pressed:** `translateY(3px)` with the shadow at 1px.
  - **Disabled:** 40% opacity, no shadow, `cursor: not-allowed`.
- **Links:** in prose, `--accent` with a 1px underline at 0.18em offset; hover switches to `--accent-hover` with a 2px underline; visited links look the same. UI links (table names, area rows) are `--ink` with no underline until hover. Footer links are `--deck-ink`, always underlined.
- **Focus ring ("life-ring focus"):** `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }` everywhere. In atmosphere zones (nav, awning, hero and shallows bands, footer, sheets over them) add `box-shadow: 0 0 0 8px var(--focus-halo)`, so the ring is measured against the halo (7.22 \| 8.60) and never against wood grain or water. Buttons with a press shadow combine both: `box-shadow: 0 0 0 8px var(--focus-halo), 0 4px 0 var(--accent-deep)`. Table rows and cards use an offset of −3px (inset) and no halo. Never remove it, and never use `--accent` for focus. The skip link keeps its 12×16px padding when focused and wears the halo, since it opens over the nav.
- **Theme toggle ("shift change"):** a 40px porthole button (brass ring, glass fill, 18px `--ink` icon) with a 44px hit area.
  - Light mode shows a **lantern** and, at `xl`, the label "Night shift"; its accessible name is "Night shift: switch to dark theme".
  - Dark mode shows a **sun** and "Day shift"; accessible name "Day shift: switch to light theme".
  - Mechanics unchanged: the first paint follows the system setting; a click sets `data-theme` on `<html>` and stores `bi-theme` in `localStorage`, with reads and writes wrapped in try/catch; an inline `<head>` script applies it before paint, so there is no flash; the footer link "Use system setting" clears the stored value. The icon swap stays CSS-driven.
- **Empty states:** a `--surface` box the height of what it replaces, 2px `--line` border, radius 16px. It holds one 64px original **spot illustration** (`aria-hidden`): an empty lobster trap for no data, a landing net for no search results, a message in a bottle for the 404. Then centered ui-m `--ink-muted` copy (max 46ch, see Voice), then an optional secondary button. Spot art never replaces the words and never animates.
- **Sheets and popovers:** native `<dialog>`, 200ms. `--bg`, radius 16px (top corners only on bottom sheets), 2px `--line` border, a rope top edge on bottom sheets, `--shadow-pop`, backdrop `rgba(4,18,26,.5)`.
- **Breadcrumbs:** ui-s `--ink-muted` with "/" separators.
- **404:** the shallows band with a porthole and a message-in-a-bottle spot illustration on the trap net. H1 "This page sank." Lede "We couldn't find that page. The index, the map and every burger are still here." Buttons "Back to the counter" (primary, to `/`) and "Search every burger" (secondary).
- **Open Graph image (1200×630, `app/og.png/route.tsx`):** a `--sea-top` → `--sea-bot` gradient, the awning across the top (an inline SVG of stripes and scallops), the Order Board centered with the plaque and life ring (the price at about 260px), and the wordmark on a `--wood-face` strip along the bottom. Built from flat fills, `linear-gradient` and inline SVG only (Satori does not do masks or repeating gradients). It carries the same numbers and the same board line as the home page. The life ring sits fully above the wood strip, and the small-print parts are spaced like words (a 7px gap after each "·"). Its alt text describes what is drawn: "The Burger Index: the NYC median burger price on a yellow order board hanging over the water". Fonts come from `@fontsource/lilita-one` (400) and `@fontsource/barlow` (500, 600) `.woff` files, replacing `@fontsource/big-shoulders` and `@fontsource/libre-franklin`.
- **Favicon (`app/icon.svg`):** the life ring on a `--sign` yellow rounded square.

## Motion
- **Tokens:** `--dur-1` 120ms (hover, color, press), `--dur-2` 200ms (tooltips, popovers, sheets, the wheel turn), `--dur-3` 320ms (chart entrance). `--ease-out: cubic-bezier(.2,.7,.2,1)`, `--ease-in: cubic-bezier(.4,0,1,1)`, `--ease-swing: cubic-bezier(.3,.7,.4,1)`.
- **Three expressive moments, first load only, all finite, all done within 4.2s:**
  1. **The board swings into place.** It rotates −5° → 3° → −1.4° → 0.5° → 0 over 1200ms (`--ease-swing`), with `transform-origin` at the beam; the ropes swing with it. The price is legible the whole time (no separate glyph fade).
  2. **The bell dings** once when the board settles (delay 1250ms): −14° → 10° → −5° → 0 over 560ms around its top, with three short "ding" strokes fading in and out.
  3. **Bubbles rise** 60px into their resting spots and fade in over 3.4s, staggered up to 0.8s, then stay still.
  - None of them replays once `html.board-seen` is set (the existing `BoardSeenMarker`).
- **Why nothing loops:** WCAG 2.2.2 needs a pause control for auto-playing motion longer than 5s alongside other content. So: no idle bubbles, no bobbing board, no drifting caustics, no waving awning.
- **People's Price boards:** when a live update reorders a board, rows glide from their old place to the new one (320ms, `--ease-out`), a new row fades in (320ms), and a row whose answer count or People's Price changed flashes `--highlight-tint` back to `--surface` once (1.2s). Each runs once per change and never loops; under reduced motion rows simply jump.
- **Micro:** the Menu button's wheel turns 45° on hover; buttons sink 3px when pressed; cards lift 2px on hover. Chart bars grow from the baseline once, the first time the chart enters the viewport (320ms total, stagger capped at 240ms), and never re-animate on filter changes. On filter changes a chart keeps its previous frame at 50% opacity until the new data renders.
- **Not allowed:** count-up numbers, parallax, scroll-jacking, scroll-linked decoration, looping or ambient motion, wobbling text, and motion inside a plot other than the one-time bar grow.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, every duration goes to 0ms and every animation to `none`: the board hangs straight, the bell is still, the bubbles are simply there, the bars are drawn, cards don't lift. Content is complete at t=0. (All three proposal mocks were checked with emulated reduced motion: `document.getAnimations()` returned 0.)

## Iconography & Imagery
- **Utility icons:** `lucide-react` stays for functional glyphs (Search, X, ChevronDown, ArrowRight, ArrowUp/Down for sort, Map, MapPin, List, ExternalLink, Globe, FileText, ShoppingBag, BookOpen, Bike, TriangleAlert, ClipboardCheck, EyeOff), set to `strokeWidth={2}` so they match the nautical set's chunkier line. Round caps and joins, `currentColor`. 16px beside 14–15px text, 20px in buttons and nav, 14px in badges. The search icon stays a magnifier everywhere a control needs to be recognized.
- **Original nautical set** (`web/src/components/icons/nautical.tsx`, hand-drawn inline SVG on a 24px grid, 2px stroke, round caps and joins, `currentColor`; `aria-hidden` unless it is a control's only content, in which case the control has an `aria-label`):

  | Icon | Drawn as | Used for |
  |---|---|---|
  | life-ring | Two concentric circles; four `--ring-a` segments on `--ring-b` via `stroke-dasharray` (circumference ÷ 8); `--ring-line` outlines; four rope-wrap ticks | Wordmark emblem, board corner, favicon, OG |
  | ship-wheel | Rim r 7, hub r 2, eight spokes running past the rim to r 10.5 with round handles | Menu button, "Filters (n)", borough/neighborhood stat tiles |
  | anchor | Ring, shank, stock, curved arms with flukes | Median label in the histogram label band, the People's Price "The Burger Index" tile |
  | spatula | A slotted blade at 45° on a straight handle | "Fresh off the grill" kicker |
  | spyglass | Three telescoping segments at −38° | "Cast a line" kicker and ticket |
  | lobster-trap | A flat-topped wire box trap in 3/4 view: diamond mesh on the front, the entrance funnel as a ring on the end face, a rope bridle to a small float. Fishing gear, never a building: no arch or dome, no ground line, no door, window, sign or chimney, and no opening centered on a facade (the first half-barrel draft read as a domed hut with a round door and was dropped) | No-data spot art |
  | porthole | Double ring with four bolts | Porthole fallback, 404 art |
  | order-bell | A service-bell dome on a base plate with a knob, plus three "ding" strokes | Board beam, hero kicker ticket |
  | lantern | Handle ring, cap, glass body, flame | Theme toggle (to night shift) |
  | sun | Circle with eight rays | Theme toggle (to day shift) |
  | net | A landing net: an oval hoop on a handle with a sagging mesh bag (a trapezoid read as a shopping basket) | Empty search spot art, "Catch of the day" kicker |
  | message-bottle | A corked bottle with a rolled note, tilted −35° | 404 art |
  | compass-rose, buoy | Plain outline objects. The buoy is a short, wide banded ball with a ring top mark riding a waterline, never a tapered tower | Mobile menu-sheet row icons: Index → life-ring, Burgers → spyglass, People's Price → scales, Map → compass-rose, Neighborhoods → buoy (the lighthouse went with the Methodology link, the ship-wheel row with Boroughs) |
| scales | The galley scales: a hanging balance, a post with a knob, a level beam and two pans on cords, on a flat foot (replaces the pennant, which marked the retired 1-10 rating) | "What's it worth?": the "People's Price" menu row, the /peoples-price ticket, the "What's it worth?" kickers and the People's Burger Index tile |

- **Imagery:** no photos, no stock, no AI illustrations, no food pictures or burger clipart, no characters or creatures of any kind. The building (planks, awning, water, board) and three small spot illustrations are the only drawn imagery. The numbers, the board and the map remain the visuals. Social images are generated from the Order Board layout.

## Voice & Copy
**The fry cook who's a stickler for the receipt.** Lead with the number. Use "we" and sentence case. Jokes go in the labels; the numbers stay literal.
- **Where puns are allowed:** kickers, the plaque, the hero ticket, button nudges, empty states, error states, the theme toggle, the legend note, the footer, the 404. One gag per screen region.
- **Where they aren't:** H1s and H2s (the computed data sentences stay as they are), numbers, bin names, badge labels, table headers, tooltips and alt text.
- **Exclamation marks:** at most one per page, and it belongs to the "ORDER UP!" plaque, or on a restaurant page (which has no board) to the WorthPicker's "Order up!" button (the 404 has none).
- **Functional labels stay functional:** a control's visible text says what it does ("Clear all", "Filters (n)", "Show 142 burgers"); nautical words may wrap a plain verb and number ("Haul in 100 more") but never replace them.
- **Strings kept verbatim (user decisions):** the hand-check label "Prices corrected by hand". The former verbatim strings "N of M restaurants looked up so far", every "a chain counts once" sentence and "Delivery-app prices usually run higher than ordering in person." were removed on 2026-09-25 (no methodology copy); "Chain prices only", "Looked up so far", "Menu found, but no beef burger on the page we read.", "Prices withheld." and "There's a burger on the menu, but no price online. Market price, apparently." went the same day with the label, the tile and the unpriced pages they belonged to (D1, D4, D10).
- **Names:** never name the show, its characters, its restaurant, its sandwich or its town anywhere on the site, its metadata, alt text or file names. Generic nods only ("order up", "fry-cook approved", "galley", "catch of the day").

| Context | String |
|---|---|
| Hero kicker ticket | "Now serving · NYC" |
| H1 (unchanged) | "What a burger costs in New York." |
| Hero lede | None while anything is priced (the menu count is on the board line); nothing priced: "No prices yet." |
| Board plaque / overline | "ORDER UP!" / "THE BURGER INDEX · NYC MEDIAN" |
| Board line (computed) | "565 menus · Updated Sep 24, 2026" |
| Stat labels | Area headers: "Median" · "vs NYC" · "Range"; the People's Price page: see below. The home page has none |
| Section kickers | "Fresh off the grill" (price spread) · "Five boroughs, one counter" (borough bars) · "Catch of the day" (cheapest/priciest) · "Neighborhood specials" (rankings) · "Cast a line" (explorer) · "Chart a course" (map page) |
| Callout kickers | "Cheapest on the counter" / "Top shelf" |
| Section H2s | Computed data sentences: "Most index prices fall between $12 and $28." / "The priciest borough is Manhattan." No "so far" and no threshold wording ("Only X is ranked.", not "has enough menus to rank") |
| Price-bin names (unchanged) | "Steal · Deal · Going rate · Pricey · Splurge" |
| Legend | Title "Depth chart · index price"; note "Colors vs NYC median $21.95. The deeper the water, the pricier the burger." |
| Buttons | "Browse all 280 burgers" · "Open the map" · paging "Haul in 100 more" with "Showing 100 of 4,812" · "Clear all" |
| Search | Label "Search every burger"; placeholder "Search burgers, restaurants, neighborhoods" ("Search burgers, restaurants" below `sm`) |
| Empty search | "No burgers match “truffle smash” in Staten Island. Nothing in the net; try fewer filters." |
| Chart minimum not met | "Only 12 priced menus in these waters." |
| Unranked area | Lede as plain counts: "3 priced menus here: 2 independent restaurants and 1 chain." (a borough: "… in Queens: …"; nothing priced, borough only: "No priced restaurants in Queens yet."). The Median tile sub-line is "Index price"; the list heading is "Other neighborhoods". A ranked area has no lede |
| Restaurant page | Overline "Restaurant" · lede the address · "The burger" · "vs Williamsburg" / "vs NYC" with "Neighborhood median $16.00" / "NYC median $20.00" · "Menu page:" / "Website:" host links · "See it on the map" · meta description "Allswell (Williamsburg, Brooklyn): Classic Allswell, $22.00." |
| Unpriced names | Neighborhood page: the `label` heading "Not priced" over plain names; `/neighborhoods`: the name and "not priced" |
| No borough priced | "No borough has a priced restaurant yet. The grill's still warming up." |
| Map, no pins for the filters | "No pins in these waters. Try fewer filters." |
| Map failed to load | "The sea chart didn't load. The list below has every restaurant." |
| Mobile filter sheet | Kicker "Your order", heading "Filters", button "Show 142 burgers", ghost "Clear all" |
| Theme toggle | "Night shift" / "Day shift" |
| 404 | "This page sank." / "We couldn't find that page. The index, the map and every burger are still here." / "Back to the counter" · "Search every burger" |
| People's Price page | Nav "People's Price" · ticket "What's it worth?" · H1 "The People's Price." · lede "What visitors would pay for each burger, next to what the menu charges. Name your price on any restaurant page; the boards update live." · tiles "People's Burger Index" / "The Burger Index" / "Answers" · kickers "Good catch" / "Walk the plank" / "Talk of the dock" / "On the pass" / "Name your price" · H2s "Biggest bargains." / "Most overpriced." / "Most answered." / "1 burger needs a few more answers." / "Find a burger." · empty "Nobody has named a price yet. Be the first." |
| WorthPicker | Kicker "What's it worth?" · H2 "What would you pay?" · label "Your price for Smash Burger" · button "Order up!" · "Slide to your price, then order up." · "Saved: $29." · "Your answer: $29." · "Answers open soon." · rate limit "Too many answers from this connection — try again in a bit." · "Couldn't load your saved answer." / "Try again" · screen readers "People's Price $26, 9 answers. Right on the money." · facts "People's Price" / "Menu price" / "Your answer" · verdicts "A bargain by 7%" / "Overpriced by 43%" / "Right on the money" / "Needs a few more answers" · figure "What people would pay" · link "See the People's Price board" |
| Home entry | Kicker "What's it worth?" · H2 "What would you pay for a burger?" · description "Name your price for any burger, then see what everyone else would pay." · button "See the People's Price" |
| Footer | "We index prices, not quality. An original seaside-diner homage: not affiliated with any restaurant, TV show or network." · "Map data © OpenStreetMap contributors, tiles by OpenFreeMap." |

- **No methodology copy (user decision, 2026-09-25):** the site has no Methodology page and no nav, footer, sitemap or in-page link to one. No sentence, paragraph, section description, footnote, tooltip, caption, chart takeaway, empty state or meta description explains how the data was gathered, computed, counted, filtered, corrected or limited: no "a chain counts once", no index-price rule, no "half charge more, half charge less", no coverage notes ("looked up N of M so far", "of 62 looked up", "on our list", "we have looked up"), no national-chain exclusions, no delivery-price caveats or "†" markers, no ranking or chart thresholds ("at least 5 menus", "Too few to rank", "enough menus to rank", "we draw the chart at 20"), no like-for-like explanations ("chain prices only so far: every priced menu here belongs to a chain"), no hand-correction reasons, no scrape notes (`status_detail`), no source or credit lines about the restaurant list or scraping, and nothing about how the People's Price, the verdicts, the People's Burger Index or the boards are computed (no "median", no "needs 3 answers", no 5% threshold, no "measured from", no "one answer per device"; "Needs a few more answers" is a state, not a rule, and names no number). Copy keeps the data and short labels: prices, names, counts, headings, source badges, "Not priced", chart titles, axes and legends, and empty states that say there is no data without saying why.

## Don'ts
**Intellectual property (hard rules):**
- **Logo and lettering:** no copy, trace, redraw or "inspired-by" version of the Krusty Krab logo, sign, lettering or emblem. No arched text over a claw, no crab-shaped badge, and no crabs in any brand mark (a crab next to this palette reads as that logo).
- **Building:** no recreation of the restaurant's building, its lobster-trap-shaped silhouette, its doors, windows or interior. A lobster trap appears only as a small fishing-gear icon.
- **Characters:** no show characters, likenesses, silhouettes, color-block stand-ins, eyes, teeth, outfits or poses. No anthropomorphic sea creatures of any kind, and no sponges or porous yellow textures, starfish, squid, crabs, plankton, snails, squirrels in diving helmets, pineapple or rock houses.
- **Scenery:** no screenshots, frames, backgrounds, props or color-picked stills from the show. No flower-shaped sky clouds and no scattered blossoms, no jellyfish, no tiki heads. The sea is evoked with generic ripples, bubbles, waves and depth only.
- **Fonts:** nothing ripped from or imitating the show's title or menu lettering (no bouncy-baseline cartoon title faces, no fan fonts). Google Fonts only: Lilita One, Nunito, Barlow.
- **Names:** no "Krusty Krab", "Krabby Patty", "SpongeBob", "Bikini Bottom", "secret formula", character names, Nickelodeon or Paramount anywhere in the product: wordmark, titles, meta tags, OG image, alt text, file names or copy. The brand is **The Burger Index**.
- **Quotes and sound:** no theme-song lyrics, catchphrases or quotes from the show.
- **Affiliation:** never claim or imply affiliation or endorsement; the footer disclaimer ships on every page. No "official" wording.
- **Burgers:** no burger or patty illustrations anywhere. A cartoon burger in a red-and-yellow sea shack reads as a specific trademarked sandwich; the price is the hero.

**Design:**
- No decoration in data zones: nothing inside plot areas, axis bands, legend swatches, tables, chips, tooltips or on the map canvas. No 3D, pies, dual axes, dashed gridlines, pictograms, area-of-circle encodings, center-aligned numbers, or shadows on data marks.
- No texture (planks, net, caustics, bubbles) behind running text without a solid backing, and no text on a band whose worst stop wasn't measured. No text over the map without a `--surface` backing. No plain-text `--accent` kicker on a sea band (use the ticket).
- No sea-ramp colors on chrome, no `--accent`, `--sign`, `--plaque` or wood on data marks, and no borough colors on the map or in a scatter. No red/green or rainbow price scales, no colored deltas, no color-only encoding, no tooltip-only values.
- No looping or ambient animation, parallax or scroll effects. Nothing auto-plays past 5s, and nothing moves under reduced motion.
- No Lilita One for any number that must align (tables, chips, ticks, tooltips), no faux-bold Lilita, no display face below 15px. No proportional figures in UI numbers and no tabular figures on the board or stat values. No Bangers, Luckiest Guy or other comic fonts; no Inter, Roboto or the system-ui default look.
- No emoji, food photos or burger clipart, including OG images and empty states.
- No blurry card shadows (block shadows only), glassmorphism, neon or grain overlays. The board's night glow is the one soft halo.
- No rotated text except the plaque's −2°; data, labels and anything focusable never rotate.
- No puns in headings, bin names, badges, status labels or table headers. No ALL-CAPS body text.
- No methodology explanations anywhere, and no Methodology page (see Voice & Copy, "No methodology copy").
- No "best", "top-rated" or other quality language about prices, the index or any restaurant, in our own voice. We index price. The one exception is "What's it worth?": its verdicts ("A bargain by 7%", "Overpriced by 43%") are the visitors' opinion and only ever appear beside the People's Price they come from, never as our own judgment of a menu.
- No horizontal page scroll at 375px.

## Key Design Decisions
- **"The Restaurant" wins over a menu or a seabed.** The page reads top to bottom as the building (facade, awning, window, order board, counter, deck), which is the most direct answer to "the Krusty Krab's own website" while staying generic seaside diner. The yellow board with red cartoon numerals is the screenshot.
- **The sea ramp replaces the heat ramp.** A red-and-yellow restaurant needs its data somewhere else on the color wheel; otherwise a red "Pricey" swatch sits beside a red button, a red active chip and a yellow board. One validated sea hue gives clean role separation and brings its own metaphor (cheap in the shallows, splurges in the trench), and it measures better under CVD (worst adjacent ΔE 10.0 \| 8.5, against 7.7). The map water is desaturated slate so pins never sink into it.
- **Bin names stay.** "Steal … Splurge" are share copy and read instantly; the nautical layer goes around them (the depth-chart legend). Tide renames were rejected because "Rock bottom" as the palest, shallowest color contradicts the depth metaphor.
- **Two-Zone Rule.** Atmosphere where nobody reads data; flat paper wherever someone does. That lets the site be loud without costing legibility.
- **Lilita One + Nunito + Barlow.** Lilita carries the cartoon sign energy; Barlow (measured tnum) carries every aligned number; Nunito keeps prose round and readable.
- **Block shadows, not blurry ones.** Flat 4px offsets read as cel-shaded cartoon objects without muddying data.
- **Focus gets a halo in atmosphere zones.** Blue on a wood grain line measured 2.84; the halo makes the ring 7.22 \| 8.60 everywhere.
- **Motion happens once.** A swing, a ding and a rise on first load, then stillness: joyful, WCAG 2.2.2-safe, and complete at t=0 under reduced motion.
- **Grafted from the runner-up directions:** the Two-Zone Rule, the "ORDER UP!" plaque that lets the board keep the brand overline, the inner-page shallows band, and the six-link nav (Direction C; five links today: Methodology left and People's Price came in on 2026-09-25, and Boroughs folded into the home page the same day); the halo focus ring, the guest-check slip for hand checks, the chip stripe, the order bell, the dotted-leader menu sheet, the "Your order" filter sheet and the explicit TV-show non-affiliation line (Direction B).

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-23 | Initial design system | Written for the Next.js build; the palettes were checked with the dataviz validator and a WCAG contrast script |
| 2026-09-23 | Big Shoulders + Newsreader + Libre Franklin | Signage display, news body, and Franklin data labels (Upshot lineage) |
| 2026-09-23 | Price bins at ±15% / ±30% of the citywide median | Colors stay stable under filters, and bin names make good share copy |
| 2026-09-23 | Chains count once: every figure, chart, ranking and threshold counts distinct menus; chain-only areas are labelled "Chain prices only" | User decision. A chain's locations share one scraped menu, so counting locations let 150+ McDonald's copies set the city number and fill the cheapest lists. So far only Manhattan has independent restaurants priced, and chain medians elsewhere must not read as borough prices |
| 2026-09-23 | National fast-food chains removed from the index (McDonald's, Burger King, Wendy's, White Castle, Checkers, Sonic, Five Guys, Smashburger, Shake Shack); NYC's own small chains (7th Street Burger, Jimbo's, Bareburger, Jackson Hole, Burger Joint, Harlem Shake) stay and still count once | User decision (the user chose to remove Shake Shack too). The other national burger and casual-dining brands listed in `pipeline/chains.py` are left out as well |
| 2026-09-23 | Partial-coverage state: while restaurants on the list are not yet looked up, the Letterboard line and OG image add "N of M restaurants looked up so far" and the home "Burgers priced" tile becomes "Looked up so far"; no_burgers reads "Menu found, but no beef burger on the page we read." | User decision. The index is mostly one neighborhood until the list is scraped, and must not read as citywide; every no_burgers row is on the user's curated burger list, so "No burgers on it" read as contradicting it |
| 2026-09-23 | Krusty Krab-style redesign (original homage, no Nickelodeon assets) | User request |
| 2026-09-24 | Redesign QA pass: the lobster trap is redrawn as a wire box trap (the half-barrel read as a domed building with a round door); the net becomes a landing net and the buoy a banded ball; detail pages share one overline form; the methodology status list stays joke-free | IP hard rule (no building silhouettes), legibility of the spot art, and the joke-free methodology rule |
| 2026-09-24 | Burger explorer rows lead with the restaurant name; the burger name is secondary | User request: people scan the list by place, and many burgers share generic names ("Cheeseburger", "Classic Burger") |
| 2026-09-25 | Removed all methodology explanations and the Methodology page from the site | User request |
| 2026-09-25 | Follow-up pass on the same request: the board line and OG image drop "Cheapest beef burger on" ("565 menus · Updated …"); restaurant meta descriptions are name, burger and price (unpriced: the badge label); histogram takeaways and the home spread H2 state index prices without the rule; "looked up", "on our list", "so far" and "Too few to rank" wording removed (the unranked list is "Other neighborhoods"); the hand-check slip is a label paragraph and its "(see above)" repeat is gone; the restaurant Source section is "Source and location." | User request ("remove all methodology explanations from the entire site"). The verbatim no_burgers / no_prices status lines and "Prices withheld." stay until the user decides whether the new request overrides those earlier decisions |
| 2026-09-25 | Visitor voting (1-10) and live Best burgers ranking on Supabase | User request |
| 2026-09-25 | 'What's it worth?' ($5-$75, People's Price) replaces the 1-10 rating | User request |
| 2026-09-25 | Cleanup with no visible change (simplification audit, stage 1): the sample fixture, its "Sample data" banner and the fixture build modes are gone (the site builds only from the pipeline's `data/burger_index.json`); comparison copy written for the Manhattan-only pilot ("Only Manhattan has priced restaurants", "Every borough lands on …", the single-neighborhood row on the home and Neighborhoods pages) gives way to one plain empty state (the single-neighborhood row stays on borough pages, where the Bronx and Staten Island use it); the pilot restaurant CSV is deleted and the run log and credit ledger are no longer committed (D13) | User decisions on the simplification audit (approved safe removals and D13) |
| 2026-09-25 | Simplification audit, stage 2 (user decisions D1–D13): only priced restaurants get a page, a sitemap URL and explorer, map-list and chain-list rows; unpriced ones are plain names under "Not priced" on their neighborhood's page, neighborhoods with nothing priced get no page (plain names on `/neighborhoods`), and their old URLs are 404s (D1). The data download and its footer link are gone (D2). The multi-burger leftovers are gone: the Protein filter and "Beef", "Index burgers only" and `?index=1`, the index tag, the "Every burger, pooled" and "Burgers priced · N beef" tiles, the "Cheapest burger of any kind" sentence and the one-row "Burgers on the menu" list (D3). The "Looked up so far" tile and the coverage-note parsing are gone (D4). The menu count shows once, on the board line: the home tile band, the hero lede count and the footer count are gone, and borough and neighborhood headers show one median (board, or a Median tile when unranked) and one vs NYC, with no "Every burger in X" link (D5). `/boroughs` folded into the home `#boroughs` section with links to the five borough pages; the nav has five links, breadcrumbs point to `/#boroughs`, and borough pages drop "Against the other boroughs" (D6). Source badges stay; the Source filter and "Hide delivery-app prices" are gone (D7). Restaurant pages are one "The burger" block (name, price, description, vs neighborhood, vs NYC, the source badge once), the menu page and website links and "See it on the map" (no mini map, no MapLibre), without the status badge, the "Source and location" list, coordinates, cuisine, ZIP and "Menu read" date (D8). The hand-check slip stays (D9; stage 3 feeds it from a structured field). "Chain prices only" and the anchor-chain icon are gone (D10). The map's list view is unchanged (D11), and so is "On the pass" (D12). D13 was done in stage 1 | User decisions on the simplification audit, 2026-09-25 |
| 2026-09-25 | Simplification audit, stage 3, with no visible change: contract version 2 carries only what the site reads. The hand-check slip reads the dataset's `hand_check` date instead of parsing the scrape note, and appears on the same 81 pages with the same dates (D9); its withheld variant, which only an unpriced restaurant (no page) could have, is gone. Unpriced restaurants stay in the dataset as names for their neighborhood's page (D1) | User decisions D1 and D9 on the simplification audit, 2026-09-25 |
