#!/usr/bin/env node
// Regenerates fixtures/burger_index.sample.json: a deterministic, schema-valid sample dataset.
// Every restaurant here is fictional and every website uses the reserved `.example` TLD, so the
// sample can never put a made-up price next to a real business. Stats, area summaries and ids are
// computed exactly the way pipeline/build.py computes them.
//
//   node scripts/generate-fixture.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "fixtures", "burger_index.sample.json");

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

// Mulberry32: tiny seeded PRNG so the fixture is identical on every run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260923);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function slugify(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const money = (x) => (x === null ? null : Math.round(x * 100) / 100);

// Menu prices end the way real menus do.
function menuPrice(x) {
  const whole = Math.floor(x);
  const endings = [0, 0, 0.5, 0.5, 0.95, 0.99, 0.25, 0.75];
  return money(whole + pick(endings));
}

const NEIGHBORHOODS = {
  "West Village": { borough: "Manhattan", lat: 40.7338, lng: -74.0037, zip: "10014", factor: 1.22, street: ["Bleecker Street", "Hudson Street", "Greenwich Avenue", "West 4th Street"] },
  "East Village": { borough: "Manhattan", lat: 40.7268, lng: -73.9832, zip: "10009", factor: 1.0, street: ["Avenue A", "East 7th Street", "1st Avenue", "St Marks Place"] },
  "Midtown-Midtown South": { borough: "Manhattan", lat: 40.7542, lng: -73.9858, zip: "10018", factor: 1.15, street: ["West 38th Street", "8th Avenue", "West 45th Street", "6th Avenue"] },
  "Hudson Yards-Chelsea-Flat Iron-Union Square": { borough: "Manhattan", lat: 40.7428, lng: -73.9992, zip: "10011", factor: 1.28, street: ["West 23rd Street", "9th Avenue", "West 18th Street"] },
  "Park Slope-Gowanus": { borough: "Brooklyn", lat: 40.6721, lng: -73.9818, zip: "11215", factor: 1.04, street: ["5th Avenue", "7th Avenue", "Union Street", "4th Avenue"] },
  "North Side-South Side": { borough: "Brooklyn", lat: 40.7159, lng: -73.9597, zip: "11211", factor: 1.1, street: ["Bedford Avenue", "Grand Street", "North 6th Street", "Berry Street"] },
  Bedford: { borough: "Brooklyn", lat: 40.6889, lng: -73.9541, zip: "11216", factor: 0.9, street: ["Nostrand Avenue", "Fulton Street", "Bedford Avenue"] },
  Astoria: { borough: "Queens", lat: 40.7648, lng: -73.9224, zip: "11103", factor: 0.95, street: ["30th Avenue", "Steinway Street", "Broadway", "31st Street"] },
  "Jackson Heights": { borough: "Queens", lat: 40.7554, lng: -73.8849, zip: "11372", factor: 0.8, street: ["37th Avenue", "Roosevelt Avenue", "82nd Street"] },
  "Forest Hills": { borough: "Queens", lat: 40.7191, lng: -73.8448, zip: "11375", factor: 0.9, street: ["Austin Street", "Queens Boulevard", "71st Avenue"] },
  "West Concourse": { borough: "Bronx", lat: 40.8322, lng: -73.9238, zip: "10452", factor: 0.76, street: ["Grand Concourse", "East 161st Street", "Gerard Avenue"] },
  "Melrose South-Mott Haven North": { borough: "Bronx", lat: 40.8153, lng: -73.9178, zip: "10451", factor: 0.72, street: ["3rd Avenue", "East 149th Street", "Willis Avenue"] },
  "West New Brighton-New Brighton-St. George": { borough: "Staten Island", lat: 40.6414, lng: -74.0868, zip: "10301", factor: 0.86, street: ["Bay Street", "Victory Boulevard", "Richmond Terrace"] },
};

// [name, neighborhood | null, borough (when neighborhood is null), status, price_source, opts]
const R = [
  // Manhattan: West Village (6 priced)
  ["Halloran's Tavern", "West Village", null, "priced", "official_site", {
    handCheck: "the scrape read the lunch menu; the dinner menu lists the same burgers, and the index uses dinner prices.",
  }],
  ["Bleecker Griddle", "West Village", null, "priced", "official_site"],
  ["Perry Street Grill", "West Village", null, "priced", "official_pdf"],
  ["Marlowe's Luncheonette", "West Village", null, "priced", "delivery_app"],
  ["Charles Lane Chophouse", "West Village", null, "priced", "official_site", { tier: 1.9 }],
  ["Little Owl Burger Bar", "West Village", null, "priced", "menu_aggregator"],
  // East Village (3 priced, 1 no_prices)
  ["Tompkins Lunch Counter", "East Village", null, "priced", "official_site", { tier: 0.75 }],
  ["Avenue A Smash Club", "East Village", null, "priced", "online_ordering"],
  ["The Night Owl Diner", "East Village", null, "no_prices", "official_site"],
  // Midtown (5 priced, 1 error)
  ["Garment District Grill", "Midtown-Midtown South", null, "priced", "official_site"],
  ["Hell's Kitchen Burger Room", "Midtown-Midtown South", null, "priced", "delivery_app"],
  ["The Brass Rail", "Midtown-Midtown South", null, "priced", "official_pdf", { tier: 1.55 }],
  ["Times Square Patty Shop", "Midtown-Midtown South", null, "priced", "online_ordering"],
  ["Herald Hall", "Midtown-Midtown South", null, "error", null],
  // Chelsea (2 priced, 1 no_menu_found)
  ["High Line Burger Kitchen", "Hudson Yards-Chelsea-Flat Iron-Union Square", null, "priced", "official_site"],
  ["Ninth Avenue Steak & Burger", "Hudson Yards-Chelsea-Flat Iron-Union Square", null, "priced", "official_site", { tier: 1.6 }],
  ["Chelsea Corner Cafe", "Hudson Yards-Chelsea-Flat Iron-Union Square", null, "no_menu_found", null],
  // Manhattan, no neighborhood on file, no coordinates
  ["Pier 40 Snack Bar", null, "Manhattan", "priced", "menu_aggregator", { noCoords: true }],
  // Brooklyn: Park Slope (5 priced, 1 no_burgers)
  ["Prospect Diner", "Park Slope-Gowanus", null, "priced", "official_site", { tier: 0.8 }],
  ["Gowanus Grill Works", "Park Slope-Gowanus", null, "priced", "official_pdf"],
  ["Seventh Avenue Burger Co.", "Park Slope-Gowanus", null, "priced", "online_ordering"],
  ["The Slope Tap Room", "Park Slope-Gowanus", null, "priced", "delivery_app"],
  ["Union Street Noodle House", "Park Slope-Gowanus", null, "no_burgers", "official_site"],
  // Williamsburg (4 priced + chain)
  ["Kestrel Burger Bar", "North Side-South Side", null, "priced", "official_site"],
  ["Berry Street Smokehouse", "North Side-South Side", null, "priced", "official_site", { tier: 1.35 }],
  ["Grand Street Luncheonette", "North Side-South Side", null, "priced", "menu_aggregator"],
  ["North Sixth Social", "North Side-South Side", null, "priced", "official_pdf"],
  // Bedford (2 priced, one without coordinates)
  ["Nostrand Grill House", "Bedford", null, "priced", "official_site"],
  ["Fulton Street Patty Palace", "Bedford", null, "priced", "delivery_app", { noCoords: true }],
  // Queens: Astoria (2 priced + chain, 1 error)
  ["Ditmars Burger Joint", "Astoria", null, "priced", "official_site"],
  ["Steinway Diner", "Astoria", null, "priced", "official_site", { tier: 0.8 }],
  ["Broadway Beer Hall", "Astoria", null, "error", "official_pdf"],
  // Jackson Heights (2 priced + chain)
  ["Roosevelt Avenue Grill", "Jackson Heights", null, "priced", "online_ordering"],
  ["82nd Street Burger Stand", "Jackson Heights", null, "priced", "official_site", { tier: 0.7 }],
  // Forest Hills (2 priced)
  ["Austin Street Tavern", "Forest Hills", null, "priced", "official_site"],
  ["Continental Burger Room", "Forest Hills", null, "priced", "menu_aggregator"],
  // Bronx: West Concourse (2 priced, 1 no_prices)
  ["Concourse Diner", "West Concourse", null, "priced", "official_site"],
  ["Yankee Plaza Grill", "West Concourse", null, "priced", "online_ordering"],
  ["Gerard Avenue Deli", "West Concourse", null, "no_prices", "menu_aggregator"],
  // Mott Haven (2 priced + chain)
  ["Willis Avenue Burger Shack", "Melrose South-Mott Haven North", null, "priced", "official_site", { tier: 0.75 }],
  ["Third Avenue Bistro", "Melrose South-Mott Haven North", null, "priced", "official_site"],
  // Staten Island (2 priced + chain), plus one without a neighborhood
  ["Ferry Terminal Grill", "West New Brighton-New Brighton-St. George", null, "priced", "official_site"],
  ["Bay Street Burger Garage", "West New Brighton-New Brighton-St. George", null, "priced", "official_pdf"],
  ["Great Kills Drive-In", null, "Staten Island", "priced", "official_site", { lat: 40.5543, lng: -74.1512, zip: "10308", street: ["Hylan Boulevard"] }],
];

// Chains: every location shares one scraped menu, like the pipeline does.
const CHAINS = [
  {
    name: "Five Borough Burger Co.",
    slug: "five-borough-burger-co",
    source: "official_site",
    menuUrl: "https://fiveboroughburger.example/menu",
    website: "https://fiveboroughburger.example/",
    locations: ["Midtown-Midtown South", "Park Slope-Gowanus", "Astoria", "Melrose South-Mott Haven North", "West New Brighton-New Brighton-St. George"],
    menu: [
      ["Hamburger", 11.49, "beef", "Quarter-pound patty, lettuce, tomato, house sauce."],
      ["Cheeseburger", 12.49, "beef", "American cheese, pickles, onion."],
      ["Double Borough Burger", 16.99, "beef", "Two patties, two slices of cheese, griddled onions."],
      ["Crispy Chicken Burger", 12.99, "chicken", null],
      ["Garden Burger", 11.99, "veggie", "Black bean and corn patty."],
    ],
  },
  {
    name: "Griddle & Stack",
    slug: "griddle-and-stack",
    source: "online_ordering",
    menuUrl: "https://order.griddleandstack.example/nyc",
    website: "https://griddleandstack.example/",
    locations: ["East Village", "North Side-South Side", "Jackson Heights"],
    menu: [
      ["Single Stack", 9.5, "beef", "One smashed patty, American, pickles."],
      ["Double Stack", 13.5, "beef", "Two smashed patties, American, onions, stack sauce."],
      ["Triple Stack", 17.0, "beef", null],
      ["Turkey Stack", 12.0, "turkey", "Ground turkey, provolone, chipotle mayo."],
    ],
  },
];

const BEEF = [
  ["Hamburger", 0.82, "Six-ounce patty on a potato roll."],
  ["Cheeseburger", 0.9, "American cheese, pickles, onion."],
  ["Classic Burger", 1.0, "Lettuce, tomato, onion, house pickles."],
  ["Smash Burger", 0.92, "Two thin patties, crispy edges, American cheese."],
  ["Diner Burger", 0.88, null],
  ["Deluxe Burger", 1.12, "With fries, lettuce and tomato."],
  ["Bacon Cheeseburger", 1.15, "Thick-cut bacon, cheddar."],
  ["Patty Melt", 1.1, "Rye, Swiss, caramelized onions."],
  ["Mushroom Swiss Burger", 1.18, "Roasted mushrooms, Swiss cheese."],
  ["Chili Burger", 1.08, "Beef chili, cheddar, raw onion."],
  ["Dry-Aged Burger", 1.6, "Dry-aged chuck and brisket blend, aged cheddar."],
  ["Wagyu Burger", 2.1, "Wagyu patty, truffle aioli, gruyère."],
  ["Double Cheeseburger", 1.3, "Two patties, double American."],
  ["Slider Trio", 1.05, "Three sliders with grilled onions."],
];
const OTHER = [
  ["Crispy Chicken Burger", "chicken", 0.95, "Buttermilk-fried thigh, slaw, pickles."],
  ["Grilled Chicken Burger", "chicken", 0.92, null],
  ["Turkey Burger", "turkey", 0.95, "Ground turkey, avocado, sprouts."],
  ["Salmon Burger", "fish", 1.2, "Salmon patty, dill yogurt, cucumber."],
  ["Tuna Burger", "fish", 1.3, "Seared tuna patty, wasabi mayo."],
  ["Veggie Burger", "veggie", 0.88, "House black bean and beet patty."],
  ["Impossible Burger", "veggie", 1.08, "Plant-based patty, vegan cheese."],
  ["Lamb Burger", "lamb", 1.2, "Spiced lamb, feta, tzatziki."],
  ["Pork Belly Burger", "pork", 1.15, "Pork and pork-belly patty, kimchi slaw."],
  ["Bison Burger", "other", 1.35, "Ground bison, smoked cheddar."],
];

const BASE = 15.5;
const STATUS_DETAIL = {
  no_prices: "The menu lists burgers but shows no prices.",
  no_burgers: "The menu was read; it has no burger items.",
  no_menu_found: "No menu page found on the website or a menu aggregator.",
  error: ["Scrape timed out after 90 seconds (408).", "The menu PDF could not be read."],
};

function scrapedAt(dayOffset) {
  const d = new Date(Date.UTC(2026, 8, 21 + dayOffset, 13 + Math.floor(rand() * 8), Math.floor(rand() * 60), Math.floor(rand() * 60)));
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

let camisSeq = 50071000;
function camis() {
  camisSeq += 37 + Math.floor(rand() * 400);
  return String(camisSeq);
}

function jitter(v) {
  return Math.round((v + (rand() - 0.5) * 0.009) * 1e6) / 1e6;
}

function address(nb, opts) {
  const streets = (opts && opts.street) || NEIGHBORHOODS[nb]?.street || ["Main Street"];
  return `${10 + Math.floor(rand() * 480)} ${pick(streets)}`;
}

function websiteFor(name) {
  const host = slugify(name).replace(/-/g, "");
  return `https://${host}.example/`;
}

function menuUrlFor(name, source) {
  const s = slugify(name);
  switch (source) {
    case "official_site":
      return `${websiteFor(name)}menu`;
    case "official_pdf":
      return `${websiteFor(name)}files/dinner-menu.pdf`;
    case "online_ordering":
      return `https://order.${s.replace(/-/g, "")}.example/`;
    case "delivery_app":
      return `https://delivery.example/store/${s}`;
    case "menu_aggregator":
      return `https://menus.example/nyc/${s}`;
    default:
      return null;
  }
}

function makeMenu(nb, tier, source) {
  const factor = (nb ? NEIGHBORHOODS[nb].factor : 1) * tier;
  const delivery = source === "delivery_app" ? 1.18 : 1;
  const nBeef = 1 + Math.floor(rand() * 3);
  const nOther = Math.floor(rand() * 2.4);
  const beef = [...BEEF].sort(() => rand() - 0.5).slice(0, nBeef);
  const other = [...OTHER].sort(() => rand() - 0.5).slice(0, nOther);
  const items = [];
  for (const [name, mult, desc] of beef) {
    items.push({ name, price: menuPrice(BASE * factor * mult * delivery * (0.9 + rand() * 0.25)), description: rand() < 0.2 ? null : desc, protein: "beef" });
  }
  for (const [name, protein, mult, desc] of other) {
    items.push({ name, price: menuPrice(BASE * factor * mult * delivery * (0.9 + rand() * 0.2)), description: desc, protein });
  }
  // Now and then a "market price" special with no number on the menu.
  if (rand() < 0.12) items.push({ name: "Burger of the Week", price: null, description: "Ask your server.", protein: "beef" });
  return items;
}

// Build raw rows: [record, displayName, results]
const rows = [];
for (const [name, nb, boroughIn, status, source, opts = {}] of R) {
  const borough = nb ? NEIGHBORHOODS[nb].borough : boroughIn;
  const hood = nb ? NEIGHBORHOODS[nb] : null;
  const tier = opts.tier ?? 0.85 + rand() * 0.4;
  let burgers = [];
  if (status === "priced") burgers = makeMenu(nb, tier, source);
  if (status === "no_prices") burgers = makeMenu(nb, tier, source).map((b) => ({ ...b, price: null }));
  const lat = opts.noCoords ? null : jitter(opts.lat ?? hood.lat);
  const lng = opts.noCoords ? null : jitter(opts.lng ?? hood.lng);
  rows.push({
    rec: {
      camis: rand() < 0.08 ? null : camis(),
      name,
      borough,
      neighborhood: nb,
      zipcode: opts.zip ?? hood?.zip ?? null,
      lat,
      lng,
      address: address(nb, opts),
      cuisine: pick(["Hamburgers", "Hamburgers", "American", "American", "Diner", "Bar/Pub", "Steakhouse"]),
      website: status === "no_menu_found" && rand() < 0.5 ? null : websiteFor(name),
    },
    chain: null,
    res: {
      status,
      burgers,
      price_source: status === "priced" || status === "no_prices" || status === "no_burgers" ? source : null,
      menu_url: status === "no_menu_found" ? null : menuUrlFor(name, source ?? "official_site"),
      status_detail:
        status === "priced"
          ? opts.handCheck
            ? `Prices corrected by hand after re-checking the menu on 2026-09-20: ${opts.handCheck}` // pipeline/corrections.py wording
            : null
          : Array.isArray(STATUS_DETAIL[status])
            ? pick(STATUS_DETAIL[status])
            : STATUS_DETAIL[status],
      scraped_at: status === "no_menu_found" && rand() < 0.5 ? null : scrapedAt(Math.floor(rand() * 3)),
    },
  });
}
for (const chain of CHAINS) {
  const at = scrapedAt(1);
  for (const nb of chain.locations) {
    const hood = NEIGHBORHOODS[nb];
    rows.push({
      rec: {
        camis: camis(),
        name: chain.name,
        borough: hood.borough,
        neighborhood: nb,
        zipcode: hood.zip,
        lat: jitter(hood.lat),
        lng: jitter(hood.lng),
        address: address(nb),
        cuisine: "Hamburgers",
        website: chain.website,
      },
      chain: chain.slug,
      res: {
        status: "priced",
        burgers: chain.menu.map(([name, price, protein, description]) => ({ name, price, protein, description })),
        price_source: chain.source,
        menu_url: chain.menuUrl,
        status_detail: null,
        scraped_at: at,
      },
    });
  }
}

// Ids, same rules as pipeline/build.py assign_restaurant_ids.
const nbShort = (nb, borough) => (nb || borough).split("-")[0].trim();
const bases = rows.map((r) => slugify(`${r.rec.name} ${nbShort(r.rec.neighborhood, r.rec.borough)}`) || "restaurant");
const counts = new Map();
bases.forEach((b) => counts.set(b, (counts.get(b) || 0) + 1));
const ids = bases.map((b, i) => (counts.get(b) > 1 && rows[i].rec.camis ? `${b}-${rows[i].rec.camis.slice(-4)}` : b));
if (new Set(ids).size !== ids.length) throw new Error("restaurant id collision in fixture");

function indexItem(burgers) {
  let best = null;
  burgers.forEach((b, i) => {
    if (b.protein === "beef" && b.price !== null && (best === null || b.price < burgers[best].price)) best = i;
  });
  return best;
}

const restaurants = rows.map((row, i) => {
  const rid = ids[i];
  const priced = row.res.status === "priced";
  const idx = priced ? indexItem(row.res.burgers) : null;
  const used = new Map();
  const out = [];
  row.res.burgers.forEach((b, j) => {
    const base = `${rid}--${slugify(b.name) || "burger"}`;
    used.set(base, (used.get(base) || 0) + 1);
    let bid = used.get(base) === 1 ? base : `${base}-${used.get(base)}`;
    while (out.some((x) => x.id === bid)) {
      used.set(base, used.get(base) + 1);
      bid = `${base}-${used.get(base)}`;
    }
    out.push({ id: bid, name: b.name, price: money(b.price), description: b.description ?? null, protein: b.protein, is_index_item: j === idx });
  });
  const nb = row.rec.neighborhood;
  return {
    id: rid,
    camis: row.rec.camis,
    name: row.rec.name,
    chain: row.chain,
    address: row.rec.address,
    borough: row.rec.borough,
    neighborhood: nb,
    neighborhood_slug: nb ? slugify(nb) || null : null,
    zipcode: row.rec.zipcode,
    lat: row.rec.lat,
    lng: row.rec.lng,
    cuisine: row.rec.cuisine,
    website: row.rec.website,
    menu_url: row.res.menu_url,
    price_source: row.res.price_source,
    status: row.res.status,
    status_detail: row.res.status_detail,
    scraped_at: row.res.scraped_at,
    index_price: idx !== null ? money(row.res.burgers[idx].price) : null,
    burgers: out,
  };
});
restaurants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Stats, same as pipeline/build.py compute_stats.
function median(sorted) {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function percentile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
// Chains count once (pipeline/build.py menu_index_prices): one index price per distinct menu, each
// chain once, every other restaurant once, and the same inside every area.
function menuIndexPrices(rs) {
  const perMenu = new Map();
  for (const r of rs) if (r.index_price !== null && !perMenu.has(r.chain ? `chain:${r.chain}` : r.id)) perMenu.set(r.chain ? `chain:${r.chain}` : r.id, r.index_price);
  return [...perMenu.values()].sort((a, b) => a - b);
}
// Rows whose burgers stand for a distinct menu: each chain's first location, every other restaurant.
const seenChains = new Set();
const menuSources = restaurants.filter((r) => {
  if (!r.chain) return true;
  if (seenChains.has(r.chain)) return false;
  seenChains.add(r.chain);
  return true;
});
const idxPrices = menuIndexPrices(restaurants);
const pricedBurgers = restaurants.flatMap((r) => r.burgers.filter((b) => b.price !== null).map((b) => [b.price, b.id]));
const distinctBurgers = menuSources.flatMap((r) => r.burgers.filter((b) => b.price !== null).map((b) => [b.price, b.id]));
const allPrices = distinctBurgers.map(([p]) => p).sort((a, b) => a - b);
const byCheap = [...distinctBurgers].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
const byDear = [...distinctBurgers].sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
const stats = {
  restaurants_scanned: restaurants.length,
  restaurants_priced: restaurants.filter((r) => r.index_price !== null).length,
  burgers: pricedBurgers.length,
  beef_burgers: restaurants.flatMap((r) => r.burgers).filter((b) => b.price !== null && b.protein === "beef").length,
  index_median: money(median(idxPrices)),
  index_mean: idxPrices.length ? money(idxPrices.reduce((s, x) => s + x, 0) / idxPrices.length) : null,
  index_p10: money(percentile(idxPrices, 0.1)),
  index_p90: money(percentile(idxPrices, 0.9)),
  all_burgers_median: money(median(allPrices)),
  cheapest_burger_id: byCheap[0]?.[1] ?? null,
  priciest_burger_id: byDear[0]?.[1] ?? null,
};

function areaSummaries(level) {
  const groups = new Map();
  for (const r of restaurants) {
    let slug, name;
    if (level === "borough") {
      slug = slugify(r.borough);
      name = r.borough;
    } else {
      if (!r.neighborhood_slug) continue;
      slug = r.neighborhood_slug;
      name = r.neighborhood;
    }
    if (!groups.has(slug)) groups.set(slug, { name, rs: [] });
    groups.get(slug).rs.push(r);
  }
  const out = [];
  for (const [slug, { name, rs }] of groups) {
    const prices = menuIndexPrices(rs); // a chain counts at most once per area
    const tally = new Map();
    rs.forEach((r) => tally.set(r.borough, (tally.get(r.borough) || 0) + 1));
    const borough = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      slug,
      name,
      borough,
      restaurants: rs.length,
      restaurants_priced: rs.filter((r) => r.index_price !== null).length,
      burgers: rs.reduce((s, r) => s + r.burgers.filter((b) => b.price !== null).length, 0),
      index_median: prices.length ? money(median(prices)) : null,
      index_min: prices.length ? money(prices[0]) : null,
      index_max: prices.length ? money(prices[prices.length - 1]) : null,
    });
  }
  out.sort((a, b) => BOROUGHS.indexOf(a.borough) - BOROUGHS.indexOf(b.borough) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

const dataset = {
  version: 1,
  generated_at: "2026-09-23T19:05:00Z",
  currency: "USD",
  methodology: {
    index_price_rule:
      "A restaurant's index price is its cheapest beef burger: the burger by itself (no combo or meal upgrade, no add-ons), single/standard size, at its dinner or all-day menu price. Lunch, brunch or late-night prices count only when no beef burger on the menu has a dinner or all-day price; happy-hour prices are left out. The Burger Index is the median index price across distinct menus: every independent restaurant counts once and each chain counts once, however many locations it has (they share one scraped menu). Borough and neighborhood figures count a chain at most once per area.",
    sources: [
      "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): restaurant list, addresses, coordinates, cuisine.",
      "2010 Neighborhood Tabulation Areas (NYC Open Data 8ius-dhrr): neighborhood names.",
      "Curated pilot list of NYC burger restaurants.",
      "Menu prices from each restaurant's own site or menu PDF, online-ordering pages, menu aggregators and delivery apps, read with Context.dev web scraping.",
    ],
    coverage_note: `SAMPLE DATA: ${restaurants.length} fictional restaurants generated for development. Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices.`,
  },
  stats,
  boroughs: areaSummaries("borough"),
  neighborhoods: areaSummaries("neighborhood"),
  restaurants,
};

writeFileSync(OUT, JSON.stringify(dataset, null, 1) + "\n");
const nBurgers = restaurants.reduce((s, r) => s + r.burgers.length, 0);
console.log(
  `wrote ${OUT}\n  ${restaurants.length} restaurants, ${dataset.neighborhoods.length} neighborhoods, ${nBurgers} burgers (${stats.burgers} priced), index median $${stats.index_median}`,
);
