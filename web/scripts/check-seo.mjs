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
// Exit 1 on any error; warnings are printed and don't fail.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "..");
const OUT = join(WEB, "out");
const DATASET = join(WEB, "..", "data", "burger_index.json");

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
const RANKING_PATH = /^\/(?:(cheapest-burgers|most-expensive-burgers)(?:\/([a-z-]+))?|burgers-under-(\d+))$/;
const CITY_RANKING_PATHS = ["/cheapest-burgers", "/most-expensive-burgers", "/burgers-under-15", "/burgers-under-20"];

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
  const [, list, slug, under] = m;
  if (slug && !BOROUGH_BY_SLUG[slug]) return { error: `unknown borough ${slug}` };
  const scope = slug ? priced.filter((r) => r.borough === BOROUGH_BY_SLUG[slug]) : priced;
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
  return { rows, total, spots, desc };
}

const count = (v) => v.toLocaleString("en-US");
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
];
function overclaims(where, str) {
  for (const re of OVERCLAIMS) {
    const m = re.exec(str);
    if (m) err(`${where}: overclaiming "${str.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)}"`);
  }
}

// ---- pages ---------------------------------------------------------------------------------------

const htmlFiles = walk(OUT).filter((f) => f.endsWith(".html") && !/(^|\/)(404|_not-found)\.html$/.test(relative(OUT, f)));
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
    checkBreadcrumbs(p, /^\/(restaurants|neighborhoods|boroughs)\//.test(path) || RANKING_PATH.test(path));
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
  }

  const hood = /^\/neighborhoods\/([^/]+)$/.exec(path);
  if (hood) {
    const table = /<table class="data-table">(.*?)<\/table>/s.exec(html)?.[1] ?? "";
    const rows = [...table.matchAll(/<th scope="row"[^>]*>\s*<a\b[^>]*href="(\/restaurants\/[^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ name: text(m[2]), path: decode(m[1]) }));
    checkItemList(p, one(p, "ItemList"), rows, "restaurant table");
  }
  const ranking = expectedRanking(path);
  if (ranking?.error) err(`${path}: ${ranking.error}`);
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
      : `The ${count(ranking.rows.length)} ${ranking.desc ? "most expensive" : "cheapest"} of ${count(ranking.total)} menus in`;
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
  for (const r of CITY_RANKING_PATHS) if (!html.includes(`href="${r}"`)) err(`${path}: no link to ${r}`);
  if (path === "/" && !text(/<section class="hero[^"]*"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "").includes(SOURCE_LINE)) err("/: no source line near the board");

  if (path === "/neighborhoods") {
    const section = /<section[^>]*aria-label="Ranked neighborhoods"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "";
    const rows = [...section.matchAll(/<th scope="row"[^>]*>.*?<a\b[^>]*href="(\/neighborhoods\/[^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ name: text(m[2]), path: decode(m[1]) }));
    const list = ofType(p, "ItemList")[0];
    if (rows.length > 1 && !list) err("/neighborhoods: no ItemList for the ranking");
    if (list) checkItemList(p, list, rows, "ranking");
  }
}

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

// ---- sitemap, robots, llms.txt, CSV --------------------------------------------------------------

const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
const pageUrls = new Set(pages.map((p) => p.url));
for (const l of locs) if (!pageUrls.has(l)) err(`sitemap lists ${l}, which is not a page`);
for (const u of pageUrls) if (!locs.includes(u)) err(`sitemap misses ${u}`);
if (new Set(locs).size !== locs.length) err("sitemap lists a URL twice");

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
console.log(`Q&A blocks: ${pages.filter((p) => p.faqs).length} pages, ${pages.reduce((n, p) => n + (p.faqs ?? 0), 0)} questions`);
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
