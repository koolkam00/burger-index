#!/usr/bin/env node
// Post-build SEO check of the static export (run after `npm run build`; not part of the build):
//
//   npm run check:seo                        # checks out/ against ../data/burger_index.json
//   npm run check:seo -- --site https://burger-index-test.vercel.app   # also assert the origin
//
// Every HTML page: one <title>, a meta description, an absolute self-referencing canonical, one <h1>,
// no skipped heading level, <img> alt text, JSON-LD that parses, has the expected @types and restates
// the page (names, prices, breadcrumbs, list order), and no Review / Rating / AggregateRating
// anywhere. Ranking pages: the table, its ranks and prices and its ItemList equal a ranking recomputed
// here from the dataset (distinct menus, a chain once). Q&A blocks: the FAQPage JSON-LD says word for
// word what the block shows, and home, borough and neighborhood pages have one. The footer carries the
// source line, the CSV link with its CC BY 4.0 license link and the NYC ranking links on every page.
// Titles and descriptions unique. The sitemap lists exactly the pages; robots.txt, llms.txt (every link
// resolves, the license named) and the CSV (one row per priced restaurant, equal to the dataset) are
// checked, and so is every internal link (no broken targets, no page without an inbound link).
// Honest wording (user decision 2026-09-25): each spot publishes its priciest burger, so no page text,
// title, description, JSON-LD, llms.txt or CSV may claim "the cheapest burger in …", "cheapest burgers
// in …" or "burgers under $15"; the cheapest lists name burger spots and their priciest burger. Every
// count matches its noun: "N burger spots" counts locations (a chain's every one), "N menus" distinct
// menus (a chain once).
// Neighborhood lists (/cheapest-burgers/<borough>/<neighborhood>) are recomputed here too, and exactly the
// neighborhoods with 10+ distinct priced menus whose two lists share no menu have them. Style lists
// (/burgers/<style>) are checked row by row against the dataset (distinct menus, prices, order, ranks,
// a style word in each burger) and say "where the priciest burger is a …". /best-burgers is recomputed
// from ../data/best_burgers.json: its rows, ranks, publication counts, menu prices, every list link and
// its ItemList; no title, description or H1 says "best burger(s)" in our own voice.
// The People's Price snapshot (../data/peoples_price.json, user decision 2026-09-25) is in the static HTML:
// every restaurant page whose menu has 3+ answers says "People's Price $22 from 14 answers, as of Sep 25, 2026."
// (and no other does), each /best-burgers row carries its menu's snapshot numbers, /peoples-price is dated and
// its "Most answered" board matches, and /best-value-burgers exists exactly when 10+ menus have a verdict, its
// rows recomputed here; until then nothing links it and only its 404 placeholder (/_none, noindex) is built.
// Sharing and link-building (user decisions 2026-09-25, stage 4): every restaurant, neighborhood, borough,
// ranking and style page and /best-burgers names its own 1200×630 share image (/og/<path>.png, a PNG of that
// size that exists, used by no other page, its alt naming the page's burger or area and price); every other
// page names /og.png; nothing under out/og/ goes unused. Every priced restaurant has /badge/<id>.svg (and
// nothing else is there), whose title states its price and how it compares with the NYC median, and its
// page links /badge?r=<id>. /badge and /press exist, are linked from every page's footer, in the sitemap
// and llms.txt; /press carries the median, the borough medians, the source line, the CSV and its license, the
// share image and the GitHub issues link. No page, llms.txt or badge carries an email address. Each
// restaurant page's "Nearby at a similar price" is recomputed here (within 1.5 km and $4, nearest first, a
// menu once, then its neighborhood), and "More in …" repeats none of it.
// Exit 1 on any error; warnings are printed and don't fail.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { histMedian, readSnapshotText } from "./snapshot-peoples-price.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "..");
const OUT = join(WEB, "out");
const DATASET = join(WEB, "..", "data", "burger_index.json");
const BEST = join(WEB, "..", "data", "best_burgers.json");
const PEOPLE = join(WEB, "..", "data", "peoples_price.json");

const args = process.argv.slice(2);
const expectSite = (() => {
  const i = args.findIndex((a) => a === "--site" || a.startsWith("--site="));
  if (i < 0) return null;
  return (args[i].includes("=") ? args[i].split("=")[1] : args[i + 1]).replace(/\/+$/, "");
})();

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

if (!existsSync(join(OUT, "index.html"))) {
  console.error("✗ out/index.html not found: run `npm run build` first");
  process.exit(1);
}
const data = JSON.parse(readFileSync(DATASET, "utf8"));
const priced = data.restaurants.filter((r) => r.index_price !== null);
const byId = new Map(priced.map((r) => [r.id, r]));

// ---- helpers -------------------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const text = (html) => decode(html.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** out/ file for a site path (strip query and hash): "/x" → x.html or the file x itself. */
function outFile(path) {
  const clean = decodeURI(path.split(/[?#]/)[0]);
  if (clean === "/" || clean === "") return join(OUT, "index.html");
  const direct = join(OUT, clean);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (existsSync(`${direct}.html`)) return `${direct}.html`;
  return null;
}

function nodesOf(doc) {
  return Array.isArray(doc["@graph"]) ? doc["@graph"] : [doc];
}
function deepTypes(value, acc = []) {
  if (Array.isArray(value)) value.forEach((v) => deepTypes(v, acc));
  else if (value && typeof value === "object") {
    if (value["@type"]) acc.push(...[].concat(value["@type"]));
    Object.values(value).forEach((v) => deepTypes(v, acc));
  }
  return acc;
}
function deepUrls(value, acc = []) {
  if (Array.isArray(value)) value.forEach((v) => deepUrls(v, acc));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (["url", "item", "contentUrl", "@id", "logo"].includes(k) && typeof v === "string") acc.push(v);
      else deepUrls(v, acc);
    }
  }
  return acc;
}
const money = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (v) => Math.round(v * 100);

// ---- rankings, recomputed from the dataset (independently of src/lib/rankings.ts) ------------------

const BOROUGH_BY_SLUG = { manhattan: "Manhattan", brooklyn: "Brooklyn", queens: "Queens", bronx: "Bronx", "staten-island": "Staten Island" };
const RANKING_PATH = /^\/(?:(cheapest-burgers|most-expensive-burgers)(?:\/([a-z-]+)(?:\/([a-z0-9-]+))?)?|burgers-under-(\d+))$/;
const STYLE_PATH = /^\/burgers\/([a-z0-9-]+)$/;
const BEST_PATH = "/best-burgers";
const CITY_RANKING_PATHS = ["/cheapest-burgers", "/most-expensive-burgers", "/burgers-under-15", "/burgers-under-20"];
// Every page's footer links these: the NYC ranking pages and the most-recommended burgers.
const PRESS_PATH = "/press";
const BADGE_PATH = "/badge";
const CONTACT_URL = "https://github.com/koolkam00/burger-index/issues";
const FOOTER_PATHS = [...CITY_RANKING_PATHS, BEST_PATH, PRESS_PATH, BADGE_PATH];
/** Distinct priced menus a neighborhood needs for its own two lists (src/lib/rankings.ts MIN_NEIGHBORHOOD_MENUS). */
const MIN_NEIGHBORHOOD_MENUS = 10;
/** Distinct menus a style needs for a page (src/lib/styles.ts MIN_STYLE_MENUS). */
const MIN_STYLE_MENUS = 10;
/**
 * A loose, independent check on each style list's rows: its burger's name or description must carry the
 * style's word (the site's classifier in src/lib/styles.ts is stricter; this catches a row that can't be
 * one). "a" is the style in the H1's words.
 */
const STYLE_WORDS = {
  smash: { a: "a smash burger", re: /smash/i },
  double: { a: "a double burger", re: /\bdouble\b|\bdbl\b|\btwo\b|\b2\b|\btwin\b/i },
  wagyu: { a: "a wagyu burger", re: /wagyu|kobe/i },
  "dry-aged": { a: "a dry-aged burger", re: /dry[\s-]?aged|day[\s-]+aged/i },
  "patty-melt": { a: "a patty melt", re: /patty[\s-]?melt/i },
};

/** Distinct menus in dataset order: a chain once (its first priced location), with its location count. */
function distinctMenus(list) {
  const byKey = new Map();
  for (const r of list) {
    const key = r.chain ? `chain:${r.chain}` : r.id;
    if (byKey.has(key)) byKey.get(key).locations += 1;
    else byKey.set(key, { key, r, price: r.index_price, locations: 1 });
  }
  return [...byKey.values()];
}
const byKeyOrder = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
function expectedRanking(path) {
  const m = RANKING_PATH.exec(path);
  if (!m) return null;
  const [, list, slug, hood, under] = m;
  if (slug && !BOROUGH_BY_SLUG[slug]) return { error: `unknown borough ${slug}` };
  if (hood && !priced.some((r) => r.neighborhood_slug === hood && r.borough === BOROUGH_BY_SLUG[slug])) return { error: `no priced restaurant in ${hood}, ${slug}` };
  const scope = hood ? priced.filter((r) => r.neighborhood_slug === hood) : slug ? priced.filter((r) => r.borough === BOROUGH_BY_SLUG[slug]) : priced;
  const desc = list === "most-expensive-burgers";
  let menus = distinctMenus(scope).sort((a, b) => (desc ? b.price - a.price : a.price - b.price) || a.r.name.localeCompare(b.r.name) || byKeyOrder(a, b));
  if (under) menus = menus.filter((x) => cents(x.price) < +under * 100);
  const total = menus.length;
  const spots = menus.reduce((n, x) => n + x.locations, 0);
  let rank = 0;
  menus.forEach((x, i) => {
    if (i === 0 || cents(x.price) !== cents(menus[i - 1].price)) rank = i + 1;
    x.rank = rank;
  });
  // Cheapest / most expensive: the first 25, at most half the place's menus (at least one), plus
  // every menu tied with the last of them; under $N: every row.
  const cap = Math.max(1, Math.min(25, Math.floor(total / 2)));
  const rows = under || menus.length <= cap ? menus : menus.filter((x) => x.rank <= menus[cap - 1].rank);
  return { rows, total, spots, desc, hood: hood ?? null };
}

/** The neighborhoods that must have their two lists: 10+ distinct priced menus, and lists that share no menu. */
const hoodsWithLists = new Map();
for (const r of priced) {
  if (!r.neighborhood_slug) continue;
  const key = `${BOROUGH_BY_SLUG_REVERSE(r.borough)}/${r.neighborhood_slug}`;
  if (!hoodsWithLists.has(key)) hoodsWithLists.set(key, { slug: r.neighborhood_slug, borough: r.borough, name: r.neighborhood });
}
function BOROUGH_BY_SLUG_REVERSE(name) {
  return Object.keys(BOROUGH_BY_SLUG).find((k) => BOROUGH_BY_SLUG[k] === name);
}
for (const [key, n] of [...hoodsWithLists]) {
  const cheap = expectedRanking(`/cheapest-burgers/${key}`);
  const pricey = expectedRanking(`/most-expensive-burgers/${key}`);
  const shared = cheap.rows.some((x) => pricey.rows.some((y) => y.key === x.key));
  if (cheap.total < MIN_NEIGHBORHOOD_MENUS || shared) hoodsWithLists.delete(key);
  else n.cheapPath = `/cheapest-burgers/${key}`;
}

const count = (v) => v.toLocaleString("en-US");
/** Restaurant and burger names that carry "best" themselves (the restaurant's words, not ours). */
const OWN_NAMES_WITH_BEST = [...new Set(priced.flatMap((r) => [r.name, r.burger.name]).filter((n) => /\bbest\b|top-rated/i.test(n)))];
const month = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", year: "numeric" }).format(new Date(data.generated_at));
const SOURCE_LINE = `Prices from restaurant menus and ordering pages, checked ${month}.`;
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

// Claims that would treat each spot's one published burger (its priciest) as if every burger on every
// menu were known. "Which borough has the cheapest burgers?" (a comparison of medians) is not one.
const OVERCLAIMS = [
  /\bcheapest burgers? (?:in|at|on|of)\b/i,
  /\bburgers (?:priced )?under \$/i,
  /\bburgers? (?:in [^.]{1,40} )?costs? (?:less than|under)\b/i,
  /\bdifferent burgers under\b/i,
  /\bno burger costs? more than\b/i,
  // A style list names the spots whose priciest burger is of the style, never every such burger.
  /\b(?:every|all(?: the)?) (?:smash|double|wagyu|dry-aged) burgers\b/i,
  /\bcheapest (?:smash|double|wagyu|dry-aged) burgers?\b/i,
  /\b(?:smash|double|wagyu|dry-aged) burgers (?:in NYC )?(?:cost|range|run)\b/i,
];
function overclaims(where, str) {
  for (const re of OVERCLAIMS) {
    const m = re.exec(str);
    if (m) err(`${where}: overclaiming "${str.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)}"`);
  }
}

// ---- the most-recommended burgers, recomputed from ../data/best_burgers.json -------------------------

const best = existsSync(BEST) ? JSON.parse(readFileSync(BEST, "utf8")) : null;
if (!best) err("../data/best_burgers.json not found");
const bestLists = new Map((best?.lists ?? []).map((l) => [l.id, l]));
const allById = new Map(data.restaurants.map((r) => [r.id, r]));
const bestEntries = (best?.places ?? [])
  .map((p) => {
    const publishers = new Set(p.sources.map((s) => bestLists.get(s.list)?.publisher).filter(Boolean));
    const r = p.restaurant_id ? allById.get(p.restaurant_id) : null;
    if (p.restaurant_id && !r) err(`best_burgers.json: ${p.key} names ${p.restaurant_id}, not in the dataset`);
    for (const s of p.sources) if (!bestLists.has(s.list)) err(`best_burgers.json: ${p.key} cites unknown list ${s.list}`);
    if (publishers.size < 2) err(`best_burgers.json: ${p.key} is named by ${publishers.size} publisher(s)`);
    return { key: p.key, name: p.name, publishers: publishers.size, lists: p.sources.map((s) => bestLists.get(s.list)).filter(Boolean), r: r && r.index_price !== null ? r : null };
  })
  .sort((a, b) => b.publishers - a.publishers || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
bestEntries.forEach((e, i) => {
  e.rank = i && e.publishers === bestEntries[i - 1].publishers ? bestEntries[i - 1].rank : i + 1;
});
for (const l of best?.lists ?? []) {
  const year = +String(l.date).slice(0, 4);
  if (!(year >= best.years.from && year <= best.years.to)) err(`best_burgers.json: list ${l.id} dated ${l.date}, outside ${best.years.from}-${best.years.to}`);
  if (/upper cut|world'?s (101|25) best/i.test(`${l.publisher} ${l.title}`)) err(`best_burgers.json: list ${l.id} is an Upper Cut Media House list`);
}

// ---- the People's Price snapshot, recomputed from ../data/peoples_price.json ---------------------------

const snap = readSnapshotText(existsSync(PEOPLE) ? readFileSync(PEOPLE, "utf8") : null) ?? { generatedAt: null, menus: {} };
if (!existsSync(PEOPLE)) warn("../data/peoples_price.json not found: the pages carry no People's Price snapshot");
/** Answers a menu needs for a verdict, and so for the People's Price sentence (src/lib/worth.ts MIN_VERDICT_ANSWERS). */
const MIN_VERDICT_ANSWERS = 3;
const BEST_VALUE_PATH = "/best-value-burgers";
/** src/lib/peoples-price.ts BEST_VALUE_MIN_VERDICTS and BEST_VALUE_MIN_GAP. */
const BEST_VALUE_MIN_VERDICTS = 10;
const BEST_VALUE_MIN_GAP = 10;
const asOfDay = snap.generatedAt
  ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(snap.generatedAt))
  : null;
const answersText = (n) => `${count(n)} answer${n === 1 ? "" : "s"}`;
const allMenus = distinctMenus(priced);
/** menu key -> { answers, people } for the dataset's answered menus (the People's Price: the median, half up). */
const crowd = new Map();
if (snap.generatedAt) {
  const known = new Set(allMenus.map((m) => m.key));
  for (const [key, e] of Object.entries(snap.menus)) {
    const hist = e?.hist && typeof e.hist === "object" ? e.hist : {};
    const total = Object.values(hist).reduce((n, v) => n + v, 0);
    if (e?.answers !== total || e?.median !== histMedian(hist)) err(`peoples_price.json: ${key}'s answers or median don't match its histogram`);
    else if (known.has(key) && total > 0) crowd.set(key, { answers: total, people: Math.floor(histMedian(hist) + 0.5) });
  }
}
const peopleSentence = (c) => `People's Price $${count(c.people)} from ${answersText(c.answers)}, as of ${asOfDay}.`;
/** The best-value rows (ranked like the People's Price bargains board), or null while the page must not exist. */
const verdictMenus = allMenus.filter((m) => (crowd.get(m.key)?.answers ?? 0) >= MIN_VERDICT_ANSWERS);
const bestValueRows = (() => {
  if (verdictMenus.length < BEST_VALUE_MIN_VERDICTS) return null;
  const EPS = 1e-9;
  const rows = verdictMenus
    .map((m) => {
      const c = crowd.get(m.key);
      return { ...m, ...c, gap: c.people >= m.price ? (c.people / m.price - 1) * 100 : -(m.price / c.people - 1) * 100 };
    })
    .filter((x) => x.gap > 0 && Math.round(x.gap) >= BEST_VALUE_MIN_GAP)
    .sort((a, b) => (Math.abs(b.gap - a.gap) > EPS ? b.gap - a.gap : 0) || b.answers - a.answers || a.r.name.localeCompare(b.r.name) || byKeyOrder(a, b));
  rows.forEach((x, i) => (x.rank = i && Math.abs(rows[i - 1].gap - x.gap) <= EPS ? rows[i - 1].rank : i + 1));
  return rows;
})();
if (bestValueRows) FOOTER_PATHS.push(BEST_VALUE_PATH);

// ---- pages ---------------------------------------------------------------------------------------

// A route with nothing to build yet builds one placeholder, the 404 (src/lib/site.ts PLACEHOLDER_PARAM:
// /best-value-burgers/_none until 10 menus have a verdict). It is not a page: noindex, never in the sitemap,
// linked from nowhere (the link check below finds a link to it broken).
const isPlaceholder = (f) => /(^|\/)_none\.html$/.test(relative(OUT, f));
for (const f of walk(OUT).filter((x) => x.endsWith(".html") && isPlaceholder(x))) {
  if (!readFileSync(f, "utf8").includes('<meta name="robots" content="noindex"/>')) err(`${relative(OUT, f)}: a placeholder that is not noindex`);
}
const htmlFiles = walk(OUT).filter((f) => f.endsWith(".html") && !isPlaceholder(f) && !/(^|\/)(404|_not-found)\.html$/.test(relative(OUT, f)));
const robots = readFileSync(join(OUT, "robots.txt"), "utf8");
const site = (/^Sitemap:\s*(\S+)\/sitemap\.xml\s*$/m.exec(robots) ?? [])[1];
if (!site) err("robots.txt has no Sitemap line");
if (expectSite && site !== expectSite) err(`site origin is ${site}, expected ${expectSite}`);

const pages = htmlFiles.map((file) => {
  const rel = relative(OUT, file).replace(/\.html$/, "");
  const path = rel === "index" ? "/" : `/${rel}`;
  const html = readFileSync(file, "utf8");
  const head = html.slice(0, html.indexOf("</head>") + 7);
  return { file, path, html, head, url: path === "/" ? site : `${site}${path}` };
});

const titles = new Map();
const descriptions = new Map();
const inbound = new Map(pages.map((p) => [p.path, 0]));
const typeCounts = new Map();
const add = (map, key, path) => map.set(key, [...(map.get(key) ?? []), path]);

for (const p of pages) {
  const { html, head, path } = p;
  const titleTags = head.match(/<title>.*?<\/title>/gs) ?? [];
  if (titleTags.length !== 1) err(`${path}: ${titleTags.length} <title> tags`);
  const title = titleTags[0] ? text(titleTags[0]) : "";
  p.title = title;
  add(titles, title, path);
  const descTag = /<meta name="description" content="[^"]*"\/?>/.exec(head);
  const description = descTag ? attr(descTag[0], "content") : "";
  if (!description) err(`${path}: no meta description`);
  p.description = description;
  add(descriptions, description, path);

  const canonTag = /<link rel="canonical" href="[^"]*"\/?>/.exec(head);
  const canonical = canonTag ? attr(canonTag[0], "href") : null;
  if (!canonical) err(`${path}: no canonical`);
  else if (!/^https?:\/\//.test(canonical)) err(`${path}: canonical not absolute (${canonical})`);
  else if (canonical !== p.url) err(`${path}: canonical ${canonical} is not the page (${p.url})`);
  const og = /<meta property="og:url" content="[^"]*"\/?>/.exec(head);
  if (og && attr(og[0], "content") !== p.url) err(`${path}: og:url ${attr(og[0], "content")} is not the page`);

  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length !== 1) err(`${path}: ${h1s.length} <h1>`);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
  levels.forEach((l, i) => {
    if (i && l > levels[i - 1] + 1) warn(`${path}: heading jumps from h${levels[i - 1]} to h${l}`);
  });
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) if (attr(img, "alt") === null) err(`${path}: <img> without alt: ${img.slice(0, 80)}`);

  // internal links
  for (const m of html.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)) {
    const href = decode(m[1]);
    const target = href.split(/[?#]/)[0] || "/";
    if (!outFile(href)) err(`${path}: broken internal link ${href}`);
    const norm = target !== "/" ? target.replace(/\/$/, "") : "/";
    if (norm !== path && inbound.has(norm)) inbound.set(norm, inbound.get(norm) + 1);
  }

  // JSON-LD
  p.ld = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    let doc;
    try {
      doc = JSON.parse(m[1]);
    } catch (e) {
      err(`${path}: JSON-LD does not parse: ${e.message}`);
      continue;
    }
    if (doc["@context"] !== "https://schema.org") err(`${path}: JSON-LD @context is ${doc["@context"]}`);
    p.ld.push(...nodesOf(doc));
    const types = deepTypes(doc);
    for (const bad of ["Review", "Rating", "AggregateRating"]) if (types.includes(bad)) err(`${path}: JSON-LD has a ${bad}`);
    for (const u of deepUrls(doc)) {
      if (site && u.startsWith(site)) {
        if (!outFile(u.slice(site.length) || "/")) err(`${path}: JSON-LD URL ${u} has no page`);
      } else if (!/^https?:\/\//.test(u)) err(`${path}: JSON-LD URL not absolute: ${u}`);
    }
  }
  for (const n of p.ld) typeCounts.set(n["@type"], (typeCounts.get(n["@type"]) ?? 0) + 1);
}

const ofType = (p, t) => p.ld.filter((n) => n["@type"] === t);
const one = (p, t) => {
  const list = ofType(p, t);
  if (list.length !== 1) err(`${p.path}: expected one ${t}, found ${list.length}`);
  return list[0];
};

/** Visible breadcrumbs: [{label, href}] from <nav aria-label="Breadcrumb">. */
function visibleCrumbs(html) {
  const nav = /<nav aria-label="Breadcrumb"[^>]*>(.*?)<\/nav>/s.exec(html);
  if (!nav) return null;
  return [...nav[1].matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((li) => {
    const a = /<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/s.exec(li[1]);
    return a ? { label: text(a[2]), href: decode(a[1]) } : { label: text(li[1].replace(/<span aria-hidden="true">\/<\/span>/, "")), href: null };
  });
}

function checkBreadcrumbs(p, expectVisible) {
  const bc = one(p, "BreadcrumbList");
  if (!bc) return;
  const items = bc.itemListElement ?? [];
  items.forEach((it, i) => {
    if (it.position !== i + 1) err(`${p.path}: breadcrumb ${i + 1} has position ${it.position}`);
    if (!it.name || !it.item) err(`${p.path}: breadcrumb ${i + 1} lacks name or item`);
  });
  if (items.length && items[items.length - 1].item !== p.url) err(`${p.path}: last breadcrumb is ${items[items.length - 1].item}, not the page`);
  const visible = visibleCrumbs(p.html);
  if (expectVisible && !visible) err(`${p.path}: no visible breadcrumbs`);
  if (visible) {
    const names = items.map((i) => i.name).join(" / ");
    const shown = visible.map((c) => c.label).join(" / ");
    if (names !== shown) err(`${p.path}: breadcrumb JSON-LD "${names}" ≠ visible "${shown}"`);
    visible.forEach((c, i) => {
      if (c.href && items[i] && items[i].item !== (c.href === "/" ? site : `${site}${c.href}`)) err(`${p.path}: breadcrumb ${i + 1} links ${c.href}, JSON-LD ${items[i].item}`);
    });
  }
}

function checkItemList(p, list, expected, label) {
  if (!list) return;
  const got = (list.itemListElement ?? []).map((e) => `${e.name} <${e.url}>`);
  const want = expected.map((e) => `${e.name} <${site}${e.path}>`);
  if (list.numberOfItems !== got.length) err(`${p.path}: ${label} numberOfItems ${list.numberOfItems} ≠ ${got.length}`);
  (list.itemListElement ?? []).forEach((e, i) => e.position !== i + 1 && err(`${p.path}: ${label} item ${i + 1} has position ${e.position}`));
  if (got.join("\n") !== want.join("\n")) err(`${p.path}: ${label} ItemList differs from the page:\n    JSON-LD ${got.slice(0, 3).join(" | ")}…\n    page    ${want.slice(0, 3).join(" | ")}…`);
}

for (const p of pages) {
  const { path, html } = p;
  if (path === "/") {
    const ds = one(p, "Dataset");
    one(p, "WebSite");
    one(p, "Organization");
    if (ds) {
      for (const k of ["name", "description", "url", "creator", "dateModified", "temporalCoverage", "spatialCoverage", "distribution"]) if (!ds[k]) err(`/: Dataset lacks ${k}`);
      if ((ds.description ?? "").length < 50) err("/: Dataset description under 50 characters");
      if (ds.license !== LICENSE_URL) err(`/: Dataset license is ${ds.license}, expected ${LICENSE_URL}`);
      const dl = [].concat(ds.distribution)[0] ?? {};
      if (dl["@type"] !== "DataDownload" || dl.encodingFormat !== "text/csv" || dl.contentUrl !== `${site}/data/burger-prices.csv`) err(`/: Dataset distribution is ${JSON.stringify(dl)}`);
      if (ds.dateModified !== data.generated_at) err(`/: Dataset dateModified ${ds.dateModified} ≠ ${data.generated_at}`);
    }
    // The cheapest/priciest cards: each h3 list heading, then its h4 card links.
    const section = /<section[^>]*aria-labelledby="cheap"[^>]*>(.*?)<\/section>/s.exec(html);
    const lists = ofType(p, "ItemList");
    if (section) {
      const groups = section[1].split(/<h3\b/).slice(1).map((g) => ({
        title: text(g.slice(g.indexOf(">") + 1, g.indexOf("</h3>"))),
        entries: [...g.matchAll(/<h4\b[^>]*>\s*<a\b[^>]*href="(\/restaurants\/[^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ name: text(m[2]), path: decode(m[1]) })),
      }));
      if (groups.length !== lists.length) err(`/: ${groups.length} card lists, ${lists.length} ItemLists`);
      groups.forEach((g, i) => {
        if (lists[i] && lists[i].name !== g.title) err(`/: ItemList ${i + 1} is "${lists[i].name}", the heading "${g.title}"`);
        checkItemList(p, lists[i], g.entries, g.title);
      });
    }
  } else {
    checkBreadcrumbs(p, /^\/(restaurants|neighborhoods|boroughs)\//.test(path) || RANKING_PATH.test(path) || STYLE_PATH.test(path) || path === BEST_PATH || path === BEST_VALUE_PATH);
  }

  const rest = /^\/restaurants\/([^/]+)$/.exec(path);
  if (rest) {
    const r = byId.get(rest[1]);
    if (!r) {
      err(`${path}: no priced restaurant with this id`);
      continue;
    }
    const n = one(p, "Restaurant");
    if (!n) continue;
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
    if (n.name !== r.name || h1 !== r.name) err(`${path}: Restaurant name "${n.name}", h1 "${h1}", dataset "${r.name}"`);
    if (n.url !== p.url) err(`${path}: Restaurant url ${n.url}`);
    if ((n.address?.streetAddress ?? null) !== r.address) err(`${path}: streetAddress ${n.address?.streetAddress} ≠ ${r.address}`);
    if (n.address?.["@type"] !== "PostalAddress" || n.address?.addressLocality !== r.borough) err(`${path}: address ${JSON.stringify(n.address)}`);
    if (r.lat !== null && (n.geo?.["@type"] !== "GeoCoordinates" || n.geo.latitude !== r.lat || n.geo.longitude !== r.lng)) err(`${path}: geo ${JSON.stringify(n.geo)}`);
    const item = n.hasMenu?.hasMenuItem;
    const offer = item?.offers;
    if (n.hasMenu?.["@type"] !== "Menu" || item?.["@type"] !== "MenuItem" || offer?.["@type"] !== "Offer") err(`${path}: hasMenu → MenuItem → Offer missing`);
    if (item?.name !== r.burger.name) err(`${path}: MenuItem "${item?.name}" ≠ "${r.burger.name}"`);
    if (offer?.price !== r.index_price.toFixed(2) || offer?.priceCurrency !== "USD") err(`${path}: Offer ${offer?.price} ${offer?.priceCurrency} ≠ ${r.index_price}`);
    const block = /<section id="burger"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "";
    if (!text(block).includes(r.burger.name)) err(`${path}: burger name not in the burger block`);
    if (!block.includes(`>${money(r.index_price)}<`)) err(`${path}: price ${money(r.index_price)} not in the burger block`);
    // The People's Price sentence: exactly the menus with 3+ answers in the snapshot.
    const c = crowd.get(r.chain ? `chain:${r.chain}` : r.id);
    const worth = text(/<section id="worth"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "");
    if (c && c.answers >= MIN_VERDICT_ANSWERS) {
      if (!worth.includes(peopleSentence(c))) err(`${path}: no "${peopleSentence(c)}" in the worth section`);
    } else if (/People's Price \$\d+ from \d/.test(worth)) err(`${path}: a People's Price sentence for a menu with ${c?.answers ?? 0} answers`);
  }

  const hood = /^\/neighborhoods\/([^/]+)$/.exec(path);
  if (hood) {
    const table = /<table class="data-table">(.*?)<\/table>/s.exec(html)?.[1] ?? "";
    const rows = [...table.matchAll(/<th scope="row"[^>]*>\s*<a\b[^>]*href="(\/restaurants\/[^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ name: text(m[2]), path: decode(m[1]) }));
    checkItemList(p, one(p, "ItemList"), rows, "restaurant table");
    // A neighborhood with its own two lists links both; one without links neither.
    const lists = [...hoodsWithLists.entries()].find(([, n]) => n.slug === hood[1]);
    const linksCheap = /href="\/cheapest-burgers\/[a-z-]+\/[a-z0-9-]+"/.test(html);
    const linksPricey = /href="\/most-expensive-burgers\/[a-z-]+\/[a-z0-9-]+"/.test(html);
    if (lists && !(html.includes(`href="/cheapest-burgers/${lists[0]}"`) && html.includes(`href="/most-expensive-burgers/${lists[0]}"`))) err(`${path}: does not link its two ranking pages`);
    if (!lists && (linksCheap || linksPricey)) err(`${path}: links a neighborhood ranking page it does not have`);
  }
  const ranking = expectedRanking(path);
  if (ranking?.error) err(`${path}: ${ranking.error}`);
  else if (ranking?.hood && ![...hoodsWithLists.keys()].some((k) => path.endsWith(`/${k}`))) err(`${path}: a neighborhood list that should not exist (fewer than ${MIN_NEIGHBORHOOD_MENUS} menus, or its two lists meet)`);
  else if (ranking) {
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
    const table = /<table class="data-table ranking-table">(.*?)<\/table>/s.exec(html)?.[1] ?? "";
    const trs = [...(/<tbody>(.*?)<\/tbody>/s.exec(table)?.[1] ?? "").matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map(([, tr]) => {
      const link = /<th scope="row"[^>]*>\s*<a\b[^>]*href="(\/restaurants\/[^"]+)"[^>]*>(.*?)<\/a>/s.exec(tr);
      return {
        rank: +(/<td class="num rank-col[^"]*">(\d+)<\/td>/.exec(tr)?.[1] ?? NaN),
        path: link ? decode(link[1]) : null,
        name: link ? text(link[2]) : null,
        price: text(/<span class="t-num-m">(.*?)<\/span>/s.exec(tr)?.[1] ?? ""),
      };
    });
    const list = one(p, "ItemList");
    checkItemList(p, list, trs, "ranking table");
    if (list && list.name !== h1.replace(/\.$/, "")) err(`${path}: ItemList "${list.name}" ≠ h1 "${h1}"`);
    if (list && list.itemListOrder !== `https://schema.org/ItemListOrder${ranking.desc ? "Descending" : "Ascending"}`) err(`${path}: ItemList order ${list.itemListOrder}`);
    const want = ranking.rows.map((x) => ({ rank: x.rank, path: `/restaurants/${x.r.id}`, name: x.r.name, price: money(x.price) }));
    const fmt = (rows) => rows.map((x) => `${x.rank}. ${x.name} <${x.path}> ${x.price}`).join("\n");
    if (fmt(trs) !== fmt(want)) err(`${path}: ranking table differs from the dataset:\n    page    ${fmt(trs).split("\n").slice(0, 3).join(" | ")}…\n    dataset ${fmt(want).split("\n").slice(0, 3).join(" | ")}…`);
    const lede = text(/<p class="t-lede[^"]*">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
    const top = ranking.rows[0];
    if (top && !(lede.includes(top.r.name) && lede.includes(money(top.price)) && lede.includes(`(${month})`))) err(`${path}: lede "${lede}" does not name ${top.r.name}, ${money(top.price)} and ${month}`);
    // The cheap lists say what they rank: each spot's priciest burger ("Cheapest burger spots in NYC.").
    if (!ranking.desc) {
      if (!/burger spots/i.test(h1)) err(`${path}: h1 "${h1}" does not name burger spots`);
      if (top && !lede.includes("priciest burger")) err(`${path}: lede "${lede}" does not say it is each spot's priciest burger`);
    }
    // How many there are, under the table: the rows are menus ("The 25 cheapest of 531 menus in NYC.",
    // "All 90 menus on this list, cheapest first.").
    const countLine = text(/<\/table>\s*<\/div>\s*<p class="t-ui-s muted mt-3">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
    const wantCount = /under/.test(path)
      ? `All ${count(ranking.rows.length)} menus on this list, cheapest first.`
      : `The ${count(ranking.rows.length)} ${ranking.desc ? "most expensive" : "cheapest"} of ${count(ranking.total)} menus ${ranking.hood ? "" : "in"}`;
    if (ranking.rows.length > 1 && !countLine.startsWith(wantCount)) err(`${path}: count line "${countLine}", expected "${wantCount} …"`);
    // "Burger spots" are locations: the under-$N lede counts them ("At 96 burger spots in NYC, …"), and
    // any "N burger spots" in the page, its title or description is the list's location count.
    if (/under/.test(path) && ranking.rows.length > 1 && !lede.startsWith(`At ${count(ranking.spots)} burger spots `)) err(`${path}: lede "${lede}" does not count ${count(ranking.spots)} burger spots`);
    for (const [where, str] of [["page", text(html.replace(/<script\b[^>]*>.*?<\/script>/gs, " "))], ["<title>", p.title], ["description", p.description]]) {
      for (const m of str.matchAll(/\b(\d[\d,]*) (?:NYC )?burger spots?\b/g)) {
        if (m[1] !== count(ranking.spots)) err(`${path} ${where}: "${m[0]}", but the list covers ${count(ranking.spots)} burger spots (${count(ranking.total)} menus)`);
      }
    }
    p.rankingRows = trs.length;
  }

  const style = STYLE_PATH.exec(path);
  if (style) {
    const want = STYLE_WORDS[style[1]];
    if (!want) err(`${path}: unknown burger style ${style[1]}`);
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
    if (want && h1 !== `Burger spots in NYC where the priciest burger is ${want.a}.`) err(`${path}: h1 "${h1}" does not say the spots' priciest burger is ${want?.a}`);
    const table = /<table class="data-table ranking-table">(.*?)<\/table>/s.exec(html)?.[1] ?? "";
    const trs = [...(/<tbody>(.*?)<\/tbody>/s.exec(table)?.[1] ?? "").matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map(([, tr]) => {
      const link = /<th scope="row"[^>]*>\s*<a\b[^>]*href="\/restaurants\/([^"]+)"[^>]*>(.*?)<\/a>/s.exec(tr);
      return { rank: +(/<td class="num rank-col[^"]*">(\d+)<\/td>/.exec(tr)?.[1] ?? NaN), id: link ? decode(link[1]) : null, name: link ? text(link[2]) : null, price: text(/<span class="t-num-m">(.*?)<\/span>/s.exec(tr)?.[1] ?? "") };
    });
    if (trs.length < MIN_STYLE_MENUS) err(`${path}: ${trs.length} rows, fewer than ${MIN_STYLE_MENUS}`);
    const menuKeys = new Set();
    let spots = 0;
    trs.forEach((t, i) => {
      const r = t.id && byId.get(t.id);
      if (!r) return err(`${path}: row ${i + 1} links no priced restaurant (${t.id})`);
      const key = r.chain ? `chain:${r.chain}` : r.id;
      if (menuKeys.has(key)) err(`${path}: ${key} listed twice (a menu once)`);
      menuKeys.add(key);
      spots += r.chain ? priced.filter((x) => x.chain === r.chain).length : 1;
      if (t.name !== r.name || t.price !== money(r.index_price)) err(`${path}: row ${i + 1} "${t.name}" ${t.price} ≠ dataset "${r.name}" ${money(r.index_price)}`);
      if (want && !want.re.test(`${r.burger.name} ${r.burger.description ?? ""}`)) err(`${path}: ${r.id}'s burger "${r.burger.name}" names no ${style[1]}`);
      const prev = i && byId.get(trs[i - 1].id);
      if (prev) {
        if (cents(prev.index_price) > cents(r.index_price)) err(`${path}: row ${i + 1} is out of price order`);
        const wantRank = cents(prev.index_price) === cents(r.index_price) ? trs[i - 1].rank : i + 1;
        if (t.rank !== wantRank) err(`${path}: row ${i + 1} has rank ${t.rank}, expected ${wantRank}`);
      } else if (t.rank !== 1) err(`${path}: the first row has rank ${t.rank}`);
    });
    checkItemList(p, one(p, "ItemList"), trs.map((t) => ({ name: t.name, path: `/restaurants/${t.id}` })), "style table");
    const lede = text(/<p class="t-lede[^"]*">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
    if (want && trs.length > 1 && !lede.startsWith(`At ${count(spots)} burger spots in NYC, the priciest burger is ${want.a} (${month})`)) err(`${path}: lede "${lede}" does not count ${count(spots)} burger spots`);
    const countLine = text(/<\/table>\s*<\/div>\s*<p class="t-ui-s muted mt-3">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
    if (countLine !== `All ${count(trs.length)} menus on this list, cheapest first.`) err(`${path}: count line "${countLine}"`);
    for (const [where, str] of [["page", text(html.replace(/<script\b[^>]*>.*?<\/script>/gs, " "))], ["<title>", p.title], ["description", p.description]]) {
      for (const m of str.matchAll(/\b(\d[\d,]*) (?:NYC )?burger spots?\b/g)) if (m[1] !== count(spots)) err(`${path} ${where}: "${m[0]}", but the list covers ${count(spots)} burger spots`);
    }
    p.styleRows = trs.length;
  }

  if (path === BEST_PATH) {
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
    if (h1 !== "The most-recommended burgers in NYC.") err(`${path}: h1 "${h1}"`);
    if (!/Ranked by how many publications named each place on a best-burger list in \d{4}–\d{4}\./.test(text(html))) err(`${path}: no ranking note`);
    const rows = [...html.matchAll(/<li class="best-row">(.*?)<\/li>\s*(?=<li class="best-row">|<\/ol>)/gs)].map(([, li]) => {
      const nameHtml = /<p class="best-name[^"]*">(.*?)<\/p>/s.exec(li)?.[1] ?? "";
      const link = /<a\b[^>]*href="(\/restaurants\/[^"#]+)"/.exec(nameHtml);
      return {
        rank: +text(/<p class="best-rank">(.*?)<\/p>/s.exec(li)?.[1] ?? "").replace(/^Rank /, ""),
        name: text(nameHtml),
        path: link ? decode(link[1]) : null,
        pubs: +(/<span class="t-num-s font-semibold">(\d+)<\/span>/.exec(li)?.[1] ?? NaN),
        price: text(/<span class="t-num-m">(.*?)<\/span>/s.exec(li)?.[1] ?? "") || null,
        hrefs: [...li.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)].map((m) => decode(m[1])),
        // Tags as spaces: the fact's label, amount and count are separate blocks.
        text: decode(li.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      };
    });
    const fmtRow = (x) => `${x.rank}. ${x.name} <${x.path}> ${x.pubs} ${x.price}`;
    const wantRows = bestEntries.map((e) => ({ rank: e.rank, name: e.name, path: e.r ? `/restaurants/${e.r.id}` : null, pubs: e.publishers, price: e.r ? money(e.r.index_price) : null }));
    if (rows.map(fmtRow).join("\n") !== wantRows.map(fmtRow).join("\n")) err(`${path}: rows differ from best_burgers.json:\n    page ${rows.slice(0, 3).map(fmtRow).join(" | ")}…\n    data ${wantRows.slice(0, 3).map(fmtRow).join(" | ")}…`);
    bestEntries.forEach((e, i) => {
      const row = rows[i];
      if (!row) return;
      for (const l of e.lists) if (!row.hrefs.includes(l.url)) err(`${path}: ${e.name}'s row does not link ${l.id} (${l.url})`);
      if (row.hrefs.length !== e.lists.length) err(`${path}: ${e.name}'s row links ${row.hrefs.length} lists, the data ${e.lists.length}`);
      // Its People's Price from the snapshot: the sentence's words with 3+ answers, "$30 2 answers" with fewer.
      const c = e.r ? crowd.get(e.r.chain ? `chain:${e.r.chain}` : e.r.id) : null;
      if (c) {
        const want = c.answers >= MIN_VERDICT_ANSWERS ? peopleSentence(c).replace(/\.$/, "") : `People's Price $${count(c.people)} ${answersText(c.answers)}`;
        if (!row.text.includes(want)) err(`${path}: ${e.name}'s row lacks "${want}"`);
      } else if (/ from \d+ answers?, as of /.test(row.text)) err(`${path}: ${e.name}'s row has a People's Price its menu doesn't`);
    });
    for (const l of best?.lists ?? []) if (!html.includes(`href="${l.url.replace(/&/g, "&amp;")}"`)) err(`${path}: list ${l.id} is not linked`);
    const list = one(p, "ItemList");
    if (list) {
      if (list.name !== h1.replace(/\.$/, "")) err(`${path}: ItemList "${list.name}" ≠ h1`);
      const got = (list.itemListElement ?? []).map((e) => `${e.position}. ${e.name} <${e.url ?? ""}>`);
      const wantLd = bestEntries.map((e, i) => `${i + 1}. ${e.name} <${e.r ? `${site}/restaurants/${e.r.id}` : ""}>`);
      if (got.join("\n") !== wantLd.join("\n") || list.numberOfItems !== bestEntries.length) err(`${path}: ItemList differs from the rows`);
    }
    p.bestRows = rows.length;
  }

  // The People's Price page: dated by the snapshot, its "Most answered" board as the snapshot has it.
  if (path === "/peoples-price" && snap.generatedAt) {
    if (!text(html).includes(`As of ${asOfDay}`)) err(`${path}: no "As of ${asOfDay}"`);
    const want = allMenus
      .filter((m) => crowd.has(m.key))
      .map((m) => ({ ...m, ...crowd.get(m.key) }))
      .sort((a, b) => b.answers - a.answers || a.r.name.localeCompare(b.r.name) || byKeyOrder(a, b))
      .slice(0, 10)
      .map((m) => `${m.r.name} $${count(m.people)} ${answersText(m.answers)}`);
    const board = /<section[^>]*aria-labelledby="answered"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "";
    const got = [...board.matchAll(/<li class="worth-row"[^>]*>(.*?)<\/li>/gs)].map(([, li]) => {
      const cell = (cls) => text(new RegExp(`<p class="worth-cell ${cls}[^"]*">(.*?)</p>`, "s").exec(li)?.[1] ?? "");
      return `${text(/<a\b[^>]*>(.*?)<\/a>/s.exec(li)?.[1] ?? "")} ${cell("wa-people").replace(/^People's /, "")} ${cell("wa-count")}`;
    });
    if (!want.length && !text(html).includes("Nobody has named a price yet.")) err(`${path}: no answers in the snapshot, but no "Nobody has named a price yet."`);
    if (want.join("\n") !== got.join("\n")) err(`${path}: "Most answered" differs from the snapshot:\n    page     ${got.slice(0, 3).join(" | ")}\n    snapshot ${want.slice(0, 3).join(" | ")}`);
    p.answeredRows = got.length;
  }

  // Best value burgers: the snapshot's menus 10% or more above their menu price, ranked by the gap.
  if (path === BEST_VALUE_PATH) {
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
    if (h1 !== "Best value burgers in NYC.") err(`${path}: h1 "${h1}"`);
    const lede = text(/<p class="t-lede[^"]*">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
    if (!lede.includes(`as of ${asOfDay})`)) err(`${path}: lede "${lede}" is not dated ${asOfDay}`);
    const board = /<ol class="worth-board"[^>]*>(.*?)<\/ol>/s.exec(html)?.[1] ?? "";
    const rows = [...board.matchAll(/<li class="worth-row"[^>]*>(.*?)<\/li>/gs)].map(([, li]) => {
      const cell = (cls) => text(new RegExp(`<p class="worth-cell ${cls}[^"]*">(.*?)</p>`, "s").exec(li)?.[1] ?? "");
      const link = /<a\b[^>]*href="(\/restaurants\/[^"]+)"[^>]*>(.*?)<\/a>/s.exec(li);
      return `${text(/<span class="worth-rank">(.*?)<\/span>\s*<div/s.exec(li)?.[1] ?? "").replace(/^Rank /, "")}. ${link ? text(link[2]) : ""} <${link ? decode(link[1]) : ""}> ${cell("wa-menu")} ${cell("wa-people")} ${cell("wa-verdict")} ${cell("wa-count")}`;
    });
    const want = (bestValueRows ?? []).map(
      (x) => `${x.rank}. ${x.r.name} </restaurants/${x.r.id}#worth> Menu ${money(x.price)} People's $${count(x.people)} A bargain by ${Math.round(x.gap)}% ${answersText(x.answers)}`,
    );
    if (rows.join("\n") !== want.join("\n")) err(`${path}: rows differ from the snapshot:\n    page     ${rows.slice(0, 3).join(" | ")}\n    snapshot ${want.slice(0, 3).join(" | ")}`);
    if (bestValueRows?.length) {
      const list = one(p, "ItemList");
      checkItemList(p, list, bestValueRows.map((x) => ({ name: x.r.name, path: `/restaurants/${x.r.id}` })), "best value list");
      if (list && list.name !== h1.replace(/\.$/, "")) err(`${path}: ItemList "${list.name}" ≠ h1`);
    } else if (ofType(p, "ItemList").length) err(`${path}: an ItemList for an empty list`);
    p.bestValueRows = rows.length;
  }

  // Our own voice never calls a burger the best: the titles, descriptions and H1s, less the restaurants'
  // own names for themselves and their burgers ("The Very Best Burger"); a list's own title, quoted on
  // /best-burgers, is the publisher's words.
  const h1Text = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(html) ?? ["", ""])[1]);
  for (const [where, str] of [["<title>", p.title], ["description", p.description], ["h1", h1Text]]) {
    const ours = OWN_NAMES_WITH_BEST.reduce((acc, n) => acc.split(n).join(" "), str);
    if (/\bbest burgers?\b|\btop-rated\b/i.test(ours)) err(`${path} ${where}: quality claim "${str}"`);
  }

  // Q&A block and its FAQPage: same questions, same words, same order.
  const faqs = ofType(p, "FAQPage");
  const qa = /<dl class="qa[^"]*">(.*?)<\/dl>/s.exec(html);
  const visibleQa = qa ? [...qa[1].matchAll(/<dt\b[^>]*>(.*?)<\/dt>\s*<dd\b[^>]*>(.*?)<\/dd>/gs)].map((m) => ({ q: text(m[1]), a: text(m[2]) })) : [];
  const needsFaq = path === "/" || /^\/(boroughs|neighborhoods)\/[^/]+$/.test(path);
  if (faqs.length > 1) err(`${path}: ${faqs.length} FAQPage nodes`);
  if (needsFaq && !faqs.length) err(`${path}: no FAQPage`);
  if (!faqs.length && visibleQa.length) err(`${path}: a Q&A block without FAQPage JSON-LD`);
  if (faqs.length === 1) {
    const marked = (faqs[0].mainEntity ?? []).map((e) => {
      if (e["@type"] !== "Question" || e.acceptedAnswer?.["@type"] !== "Answer") err(`${path}: FAQPage entry is not Question → Answer`);
      return { q: e.name, a: e.acceptedAnswer?.text };
    });
    const show = (list) => list.map((x) => `Q: ${x.q}\n      A: ${x.a}`).join("\n      ");
    if (JSON.stringify(marked) !== JSON.stringify(visibleQa)) err(`${path}: FAQPage ≠ the visible Q&A:\n      ${show(marked)}\n    visible:\n      ${show(visibleQa)}`);
    // Spot-check the first answer's number against the dataset.
    const area = path === "/" ? data.stats : /^\/boroughs\//.test(path) ? data.boroughs.find((b) => `/boroughs/${b.slug}` === path) : data.neighborhoods.find((n) => `/neighborhoods/${n.slug}` === path);
    if (area?.index_median != null && visibleQa[0] && !visibleQa[0].a.includes(money(area.index_median))) err(`${path}: first answer lacks the median ${money(area.index_median)}: ${visibleQa[0].a}`);
    p.faqs = visibleQa.length;
  }

  // Footer: the source line, the CSV link with its license and the NYC ranking links, on every page;
  // home also has the line by the board.
  const footerHtml = /<footer\b[^>]*>(.*?)<\/footer>/s.exec(html)?.[1] ?? "";
  const footer = text(footerHtml);
  if (!footer.includes(SOURCE_LINE)) err(`${path}: footer lacks "${SOURCE_LINE}"`);
  const csvAt = footerHtml.indexOf('href="/data/burger-prices.csv"');
  const licenseAt = footerHtml.indexOf(`href="${LICENSE_URL}"`);
  if (licenseAt < 0 || !/<a\b[^>]*href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*rel="license"[^>]*>CC BY 4\.0/.test(footerHtml)) err(`${path}: footer lacks the "CC BY 4.0" license link`);
  else if (csvAt < 0 || licenseAt < csvAt) err(`${path}: the license link does not follow the CSV link`);

  // Honest wording: the visible text, the title and description and the JSON-LD.
  overclaims(path, text(html.replace(/<script\b[^>]*>.*?<\/script>/gs, " ")));
  overclaims(`${path} <title>`, p.title);
  overclaims(`${path} description`, p.description);
  overclaims(`${path} JSON-LD`, JSON.stringify(p.ld));
  for (const r of FOOTER_PATHS) if (!html.includes(`href="${r}"`)) err(`${path}: no link to ${r}`);
  if (path === "/" && !text(/<section class="hero[^"]*"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "").includes(SOURCE_LINE)) err("/: no source line near the board");

  if (path === "/neighborhoods") {
    const section = /<section[^>]*aria-label="Ranked neighborhoods"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "";
    const rows = [...section.matchAll(/<th scope="row"[^>]*>.*?<a\b[^>]*href="(\/neighborhoods\/[^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ name: text(m[2]), path: decode(m[1]) }));
    const list = ofType(p, "ItemList")[0];
    if (rows.length > 1 && !list) err("/neighborhoods: no ItemList for the ranking");
    if (list) checkItemList(p, list, rows, "ranking");
  }
}

// Every neighborhood that should have its two lists has them.
for (const [key] of hoodsWithLists) {
  for (const base of ["/cheapest-burgers", "/most-expensive-burgers"]) if (!pages.some((p) => p.path === `${base}/${key}`)) err(`missing ${base}/${key}`);
}
if (!pages.some((p) => p.path === BEST_PATH)) err(`missing ${BEST_PATH}`);
const hasBestValue = pages.some((p) => p.path === BEST_VALUE_PATH);
if (bestValueRows && !hasBestValue) err(`missing ${BEST_VALUE_PATH}: ${verdictMenus.length} menus have a verdict (it needs ${BEST_VALUE_MIN_VERDICTS})`);
if (!bestValueRows && hasBestValue) err(`${BEST_VALUE_PATH} exists, but only ${verdictMenus.length} menus have a verdict (it needs ${BEST_VALUE_MIN_VERDICTS})`);

// ---- uniqueness and lengths ----------------------------------------------------------------------

const dupes = (map, what) => {
  for (const [k, paths] of map) if (paths.length > 1) err(`duplicate ${what} "${k}": ${paths.join(", ")}`);
};
dupes(titles, "title");
dupes(descriptions, "description");
function histogram(values, edges) {
  const buckets = [...edges.map((e, i) => ({ label: `${i ? edges[i - 1] + 1 : 0}-${e}`, n: 0 })), { label: `>${edges[edges.length - 1]}`, n: 0 }];
  for (const v of values) {
    const i = edges.findIndex((e) => v <= e);
    buckets[i === -1 ? buckets.length - 1 : i].n += 1;
  }
  return buckets.filter((b) => b.n).map((b) => `${b.label}: ${b.n}`).join(", ");
}
const tl = pages.map((p) => p.title.length);
const dl = pages.map((p) => p.description.length);
for (const p of pages) if (p.description.length > 160) err(`${p.path}: description is ${p.description.length} characters`);

// ---- share images, badges, the press kit, nearby (stage 4) ------------------------------------------

/** The page's own share image, by page type; every other page uses the site's /og.png. */
function expectedImage(path) {
  const own = /^\/(restaurants|neighborhoods|boroughs)\/[^/]+$/.test(path) || RANKING_PATH.test(path) || STYLE_PATH.test(path) || path === BEST_PATH;
  return own ? `/og${path}.png` : "/og.png";
}
/** [width, height] of a PNG file, or null. */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("latin1", 12, 16) !== "IHDR") return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
const metaContent = (head, attr, name) => {
  const tag = new RegExp(`<meta ${attr}="${name.replace(/[:.]/g, "\\$&")}" content="[^"]*"/?>`).exec(head);
  return tag ? decode(/content="([^"]*)"/.exec(tag[0])[1]) : null;
};
const usedImages = new Map();
for (const p of pages) {
  const want = expectedImage(p.path);
  const og = metaContent(p.head, "property", "og:image");
  if (og !== `${site}${want}`) {
    err(`${p.path}: og:image ${og}, expected ${site}${want}`);
    continue;
  }
  if (metaContent(p.head, "name", "twitter:image") !== og) err(`${p.path}: twitter:image is not the og:image`);
  if (metaContent(p.head, "name", "twitter:card") !== "summary_large_image") err(`${p.path}: twitter:card is not summary_large_image`);
  if (metaContent(p.head, "property", "og:image:width") !== "1200" || metaContent(p.head, "property", "og:image:height") !== "630") err(`${p.path}: og:image is not declared 1200×630`);
  const alt = metaContent(p.head, "property", "og:image:alt");
  if (!alt) err(`${p.path}: no og:image:alt`);
  const file = outFile(want);
  const size = file ? pngSize(file) : null;
  if (!size || size[0] !== 1200 || size[1] !== 630) err(`${p.path}: ${want} is ${file ? `a ${size ? size.join("×") : "non-PNG"} file` : "missing"}, not a 1200×630 PNG`);
  usedImages.set(want, [...(usedImages.get(want) ?? []), p.path]);
  if (want === "/og.png" || !alt) continue;
  // The card is the page's own: its alt names the restaurant and its price, the area and its median, or the list.
  const rest = /^\/restaurants\/([^/]+)$/.exec(p.path);
  const area = /^\/(neighborhoods|boroughs)\/([^/]+)$/.exec(p.path);
  if (rest) {
    const r = byId.get(rest[1]);
    if (r && !(alt.includes(r.name) && alt.includes(money(r.index_price)))) err(`${p.path}: share image alt "${alt}" does not name ${r.name} and ${money(r.index_price)}`);
  } else if (area) {
    const a = (area[1] === "boroughs" ? data.boroughs : data.neighborhoods).find((x) => x.slug === area[2]);
    if (a?.index_median != null && !alt.includes(money(a.index_median))) err(`${p.path}: share image alt "${alt}" lacks the median ${money(a.index_median)}`);
  } else {
    const h1 = text((/<h1[^>]*>(.*?)<\/h1>/s.exec(p.html) ?? ["", ""])[1]).replace(/\.$/, "");
    if (!alt.includes(h1)) err(`${p.path}: share image alt "${alt}" does not name "${h1}"`);
  }
}
for (const [img, paths] of usedImages) if (img !== "/og.png" && paths.length > 1) err(`${img} is the share image of ${paths.join(", ")}`);
const ogDir = join(OUT, "og");
const ogFiles = existsSync(ogDir) ? walk(ogDir).map((f) => `/${relative(OUT, f)}`) : [];
for (const f of ogFiles) if (!usedImages.has(f)) err(`${f}: a share image no page names`);
const ogBytes = ogFiles.reduce((n, f) => n + statSync(join(OUT, f)).size, 0);

// Badges: exactly one per priced restaurant, honest text, linked from its page.
const badgeDir = join(OUT, "badge");
// The /badge page's own client-navigation payloads (__next.*.txt) share the folder.
const badgeFiles = existsSync(badgeDir) ? readdirSync(badgeDir).filter((f) => statSync(join(badgeDir, f)).isFile() && !f.startsWith("__next.")) : [];
const wantBadges = new Set(priced.map((r) => `${r.id}.svg`));
if (!priced.length) wantBadges.add("_none.svg");
for (const f of badgeFiles) if (!wantBadges.has(f)) err(`/badge/${f}: a badge for no priced restaurant`);
const shortMoney = (v) => (cents(v) % 100 ? money(v) : `$${count(cents(v) / 100)}`);
const vsNyc = (v) => {
  const m = data.stats.index_median;
  if (m == null) return null;
  const pct = ((v - m) / m) * 100;
  return Math.abs(pct) < 0.5 ? `right at the ${money(m)} NYC median` : `${Math.round(Math.abs(pct))}% ${pct > 0 ? "above" : "below"} the ${money(m)} NYC median`;
};
let badgeBytes = 0;
for (const r of priced) {
  const file = join(badgeDir, `${r.id}.svg`);
  if (!existsSync(file)) {
    err(`/badge/${r.id}.svg is missing`);
    continue;
  }
  const svg = readFileSync(file, "utf8");
  badgeBytes += svg.length;
  if (!/^<svg\b[^>]*\swidth="300"[^>]*\sheight="84"/.test(svg)) err(`/badge/${r.id}.svg: not a 300×84 SVG`);
  if (/<script|\son[a-z]+=|javascript:/i.test(svg)) err(`/badge/${r.id}.svg: carries script`);
  const vs = vsNyc(r.index_price);
  const label = `${shortMoney(r.index_price)} burger${vs ? `, ${vs}` : ""} (The Burger Index, ${month})`;
  const title = decode(/<title>(.*?)<\/title>/s.exec(svg)?.[1] ?? "");
  if (title !== label) err(`/badge/${r.id}.svg: title "${title}", expected "${label}"`);
  const page = pages.find((p) => p.path === `/restaurants/${r.id}`);
  if (page && !page.html.includes(`href="/badge?r=${r.id}"`)) err(`/restaurants/${r.id}: no link to its badge (/badge?r=${r.id})`);
}

// The badge page and the press kit.
const badgePage = pages.find((p) => p.path === BADGE_PATH);
if (!badgePage) err(`missing ${BADGE_PATH}`);
else {
  const img = /<img\b[^>]*src="\/badge\/([a-z0-9-]+)\.svg"[^>]*>/.exec(badgePage.html);
  const r = img && byId.get(img[1]);
  if (!r) err(`${BADGE_PATH}: no example badge of a priced restaurant`);
  else {
    const snippet = decode(/<textarea\b[^>]*>(.*?)<\/textarea>/s.exec(badgePage.html)?.[1] ?? "");
    const want = `<a href="${site}/restaurants/${r.id}"><img src="${site}/badge/${r.id}.svg" width="300" height="84" alt="`;
    if (!snippet.startsWith(want)) err(`${BADGE_PATH}: the HTML snippet "${snippet.slice(0, 120)}" does not link ${r.id}'s page and badge`);
    if (!snippet.includes(`${r.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")} on The Burger Index: ${shortMoney(r.index_price)} burger`)) err(`${BADGE_PATH}: the snippet's alt does not name ${r.name} and its price`);
  }
}
const press = pages.find((p) => p.path === PRESS_PATH);
if (!press) err(`missing ${PRESS_PATH}`);
else {
  const main = /<main\b[^>]*>(.*?)<\/main>/s.exec(press.html)?.[1] ?? "";
  const body = text(main);
  if (data.stats.index_median != null && !body.includes(money(data.stats.index_median))) err(`${PRESS_PATH}: no NYC median ${money(data.stats.index_median)}`);
  for (const b of data.boroughs) if (b.index_median != null && b.restaurants_priced && !body.includes(money(b.index_median))) err(`${PRESS_PATH}: no ${b.name} median ${money(b.index_median)}`);
  if (!body.includes(SOURCE_LINE)) err(`${PRESS_PATH}: no source line`);
  for (const href of ['href="/data/burger-prices.csv"', `href="${LICENSE_URL}"`, `href="${CONTACT_URL}"`]) if (!main.includes(href)) err(`${PRESS_PATH}: the page does not link ${href}`);
  if (!/<img\b[^>]*src="\/og\.png"[^>]*alt="[^"]+"/.test(main)) err(`${PRESS_PATH}: no share image`);
  if (!body.includes(`${site}. CC BY 4.0.`)) err(`${PRESS_PATH}: the credit line lacks the site and the license`);
}

// No email address anywhere we publish (the contact is the GitHub issues page).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
for (const p of pages) {
  if (/mailto:/i.test(p.html)) err(`${p.path}: a mailto: link`);
  const m = EMAIL.exec(text(p.html.replace(/<script\b[^>]*>.*?<\/script>/gs, " ")));
  if (m) err(`${p.path}: an email address "${m[0]}"`);
}

// "Nearby at a similar price": within 1.5 km and $4 of the restaurant's price, nearest first, a menu once
// (its own chain never), then its neighborhood, closest in price first; at most four.
const NEAR_KM = 1.5;
const NEAR_GAP = 400;
const menuOf = (r) => (r.chain ? `chain:${r.chain}` : r.id);
function kmBetween(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function expectedNearby(r) {
  const gap = (x) => Math.abs(cents(x.index_price) - cents(r.index_price));
  const byName = (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sim = priced.filter((x) => x.id !== r.id && menuOf(x) !== menuOf(r) && gap(x) <= NEAR_GAP).map((x) => ({ x, d: kmBetween(r, x) }));
  const out = [];
  const seen = new Set();
  const take = (list) => {
    for (const s of list) {
      if (out.length >= 4 || seen.has(menuOf(s.x))) continue;
      seen.add(menuOf(s.x));
      out.push(s);
    }
  };
  take(sim.filter((s) => s.d !== null && s.d <= NEAR_KM).sort((a, b) => a.d - b.d || gap(a.x) - gap(b.x) || byName(a.x, b.x)));
  if (r.neighborhood_slug) take(sim.filter((s) => s.x.neighborhood_slug === r.neighborhood_slug).sort((a, b) => gap(a.x) - gap(b.x) || (a.d ?? Infinity) - (b.d ?? Infinity) || byName(a.x, b.x)));
  return out;
}
let nearbyPages = 0;
let nearbyRows = 0;
for (const r of priced) {
  const page = pages.find((p) => p.path === `/restaurants/${r.id}`);
  if (!page) continue;
  const section = /<section[^>]*aria-labelledby="similar-price"[^>]*>(.*?)<\/section>/s.exec(page.html)?.[1] ?? "";
  const rows = [...section.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map(([, li]) => ({
    id: decode(/href="\/restaurants\/([^"]+)"/.exec(li)?.[1] ?? ""),
    sub: text(/<span class="t-ui-s[^"]*">(.*?)<\/span>/s.exec(li)?.[1] ?? ""),
    price: text(/<span class="t-num-m">(.*?)<\/span>/s.exec(li)?.[1] ?? ""),
  }));
  const want = expectedNearby(r);
  const fmt = (list) => list.map((x) => x.id ?? x.x.id).join(", ");
  if (fmt(rows) !== fmt(want)) err(`/restaurants/${r.id}: "Nearby at a similar price" is [${fmt(rows)}], expected [${fmt(want)}]`);
  rows.forEach((row, i) => {
    const w = want[i];
    if (!w || w.x.id !== row.id) return;
    if (row.price !== money(w.x.index_price)) err(`/restaurants/${r.id}: nearby ${row.id} shows ${row.price}, not ${money(w.x.index_price)}`);
    if (w.d !== null && !row.sub.endsWith(`${Math.max(0.1, Math.round((w.d / 1.609344) * 10) / 10).toFixed(1)} mi away`)) err(`/restaurants/${r.id}: nearby ${row.id} says "${row.sub}"`);
  });
  if (!want.length && section) err(`/restaurants/${r.id}: an empty "Nearby at a similar price"`);
  const more = /<section[^>]*aria-labelledby="nearby"[^>]*>(.*?)<\/section>/s.exec(page.html)?.[1] ?? "";
  const shown = new Set(want.map((w) => menuOf(w.x)));
  for (const m of more.matchAll(/href="\/restaurants\/([^"]+)"/g)) {
    const x = byId.get(decode(m[1]));
    if (x && shown.has(menuOf(x))) err(`/restaurants/${r.id}: "More in …" repeats ${x.id} from "Nearby at a similar price"`);
  }
  if (rows.length) nearbyPages += 1;
  nearbyRows += rows.length;
}

// ---- sitemap, robots, llms.txt, CSV --------------------------------------------------------------

const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
const pageUrls = new Set(pages.map((p) => p.url));
for (const l of locs) if (!pageUrls.has(l)) err(`sitemap lists ${l}, which is not a page`);
for (const u of pageUrls) if (!locs.includes(u)) err(`sitemap misses ${u}`);
if (new Set(locs).size !== locs.length) err("sitemap lists a URL twice");
for (const l of locs) if (/\.(png|svg|jpe?g|csv|json|txt)$/i.test(l)) err(`sitemap lists a file: ${l}`);

for (const need of ["User-Agent: *", "Allow: /", "Disallow: /ingest/", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot"]) {
  if (!robots.includes(need)) err(`robots.txt lacks "${need}"`);
}
if (/^Disallow:\s*\/\s*$/m.test(robots)) err("robots.txt disallows the whole site for some agent");
const disallows = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
if (disallows.some((d) => d !== "/ingest/")) err(`robots.txt disallows more than /ingest/: ${disallows.join(", ")}`);

const llms = readFileSync(join(OUT, "llms.txt"), "utf8");
overclaims("llms.txt", llms);
if (!new RegExp(`\\[Burger prices \\(CSV\\)\\]\\(${site}/data/burger-prices\\.csv\\):[^\\n]*License: CC BY 4\\.0 \\(${LICENSE_URL.replace(/[./]/g, "\\$&")}\\)`).test(llms)) err("llms.txt: the CSV link does not name its license (CC BY 4.0)");
// The ranking notes count like the pages: burger spots are locations, menus count a chain once.
for (const path of CITY_RANKING_PATHS) {
  const r = expectedRanking(path);
  const line = llms.split("\n").find((l) => l.includes(`](${site}${path})`)) ?? "";
  const want = /under/.test(path) ? `: ${count(r.spots)} burger spots, ` : ` of ${count(r.total)} menus`;
  if (!line.includes(want)) err(`llms.txt: the ${path} line "${line}" lacks "${want}"`);
}
const llmsLinks = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
for (const p of pages) {
  if ((RANKING_PATH.test(p.path) || STYLE_PATH.test(p.path) || p.path === BEST_PATH || p.path === BEST_VALUE_PATH) && !llmsLinks.includes(p.url)) err(`llms.txt does not link ${p.path}`);
}
for (const path of [PRESS_PATH, BADGE_PATH]) if (!llmsLinks.includes(`${site}${path}`)) err(`llms.txt does not link ${path}`);
if (EMAIL.test(llms)) err("llms.txt carries an email address");
for (const l of llmsLinks) {
  if (!l.startsWith(site)) err(`llms.txt links off-site: ${l}`);
  else if (!outFile(l.slice(site.length) || "/")) err(`llms.txt link does not resolve: ${l}`);
}

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF line ends. */
function parseCsv(src) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\r" && src[i + 1] === "\n") {
      endRow();
      i++;
    } else if (c === "\n") endRow();
    else field += c;
  }
  if (field || row.length) endRow();
  return rows;
}
const LABEL = { official_site: "Restaurant site", official_pdf: "Menu PDF", online_ordering: "Online ordering", menu_aggregator: "Menu aggregator", delivery_app: "Delivery app" };
const checked = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(data.generated_at));
const csvSrc = readFileSync(join(OUT, "data", "burger-prices.csv"), "utf8");
overclaims("CSV", csvSrc);
if (csvSrc.charCodeAt(0) === 0xfeff) warn("CSV starts with a BOM");
const [header, ...csvRows] = parseCsv(csvSrc);
const COLS = ["restaurant", "neighborhood", "borough", "burger", "price_usd", "source", "page_url", "checked"];
if (header.join(",") !== COLS.join(",")) err(`CSV header is ${header.join(",")}`);
if (csvRows.length !== priced.length) err(`CSV has ${csvRows.length} rows, the dataset ${priced.length} priced restaurants`);
const seenIds = new Set();
for (const row of csvRows) {
  const o = Object.fromEntries(COLS.map((c, i) => [c, row[i]]));
  if (row.length !== COLS.length) err(`CSV row has ${row.length} fields: ${row.join("|")}`);
  const id = o.page_url?.startsWith(`${site}/restaurants/`) ? o.page_url.slice(`${site}/restaurants/`.length) : null;
  const r = id && byId.get(id);
  if (!r) {
    err(`CSV row points at no priced restaurant: ${o.page_url}`);
    continue;
  }
  if (seenIds.has(id)) err(`CSV lists ${id} twice`);
  seenIds.add(id);
  const unformula = (s) => (s?.startsWith("'") && /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
  const want = { restaurant: r.name, neighborhood: r.neighborhood ?? "", borough: r.borough, burger: r.burger.name, price_usd: r.index_price.toFixed(2), source: LABEL[r.price_source], checked };
  for (const [k, v] of Object.entries(want)) if (unformula(o[k]) !== v) err(`CSV ${id} ${k} "${o[k]}" ≠ "${v}"`);
  if (!outFile(`/restaurants/${id}`)) err(`CSV page_url has no page: ${o.page_url}`);
}

for (const p of pages) if (!p.html.includes('href="/data/burger-prices.csv"')) err(`${p.path}: no footer CSV link`);

const orphans = [...inbound].filter(([path, n]) => n === 0 && path !== "/");
for (const [path] of orphans) warn(`${path}: no inbound link from another page's static HTML`);

// ---- report --------------------------------------------------------------------------------------

console.log(`site ${site} · ${pages.length} pages · sitemap ${locs.length} URLs · CSV ${csvRows.length} rows · llms.txt ${llmsLinks.length} links`);
console.log(`JSON-LD nodes: ${[...typeCounts].map(([t, n]) => `${t} ${n}`).join(", ")}`);
const rankingPages = pages.filter((p) => p.rankingRows !== undefined);
console.log(`ranking pages: ${rankingPages.length} (${rankingPages.map((p) => `${p.path} ${p.rankingRows}`).join(", ")})`);
const stylePages = pages.filter((p) => p.styleRows !== undefined);
console.log(`style pages: ${stylePages.map((p) => `${p.path} ${p.styleRows}`).join(", ")} · best-burgers rows: ${pages.find((p) => p.path === BEST_PATH)?.bestRows ?? 0}`);
console.log(`Q&A blocks: ${pages.filter((p) => p.faqs).length} pages, ${pages.reduce((n, p) => n + (p.faqs ?? 0), 0)} questions`);
console.log(
  `People's Price snapshot: ${asOfDay ? `as of ${asOfDay}` : "none"} · answered menus ${crowd.size}, with a verdict ${verdictMenus.length} · ` +
    `restaurant pages with the sentence ${[...crowd].filter(([, c]) => c.answers >= MIN_VERDICT_ANSWERS).reduce((n, [key]) => n + allMenus.find((m) => m.key === key).locations, 0)} · ` +
    (hasBestValue ? `${BEST_VALUE_PATH}: ${pages.find((p) => p.path === BEST_VALUE_PATH).bestValueRows} rows` : `no ${BEST_VALUE_PATH} (needs ${BEST_VALUE_MIN_VERDICTS} verdicts)`),
);
console.log(
  `share images: ${ogFiles.length} (${(ogBytes / 1048576).toFixed(1)} MB, ${ogFiles.length ? Math.round(ogBytes / ogFiles.length / 1024) : 0} KB each on average) · badges: ${badgeFiles.length} (${(badgeBytes / 1048576).toFixed(1)} MB) · ` +
    `nearby at a similar price: ${nearbyPages} restaurant pages, ${nearbyRows} rows`,
);
console.log(`title lengths: min ${Math.min(...tl)}, max ${Math.max(...tl)}, ${tl.filter((n) => n > 60).length} over 60 · ${histogram(tl, [40, 50, 60, 70, 80])}`);
console.log(`description lengths: min ${Math.min(...dl)}, max ${Math.max(...dl)} · ${histogram(dl, [100, 120, 140, 150, 160])}`);
for (const w of warnings.slice(0, 40)) console.log(`  ⚠ ${w}`);
if (warnings.length > 40) console.log(`  ⚠ … ${warnings.length - 40} more warnings`);
if (errors.length) {
  for (const e of errors.slice(0, 60)) console.error(`  ✗ ${e}`);
  if (errors.length > 60) console.error(`  ✗ … ${errors.length - 60} more errors`);
  console.error(`✗ ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`✓ SEO check passed${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}`);
