// /llms.txt (llmstxt.org): a plain Markdown summary for AI assistants with the headline numbers, the
// date and links to the main pages and the CSV. Numbers and labels only, like the site (DESIGN.md
// "No methodology copy"). Pure: app/llms.txt/route.ts gathers the inputs from data.ts.
import { formatCount, formatDate, formatPrice, pluralize } from "./format";

export type LlmsLink = { title: string; path: string; note?: string };
export type LlmsSection = { title: string; links: readonly LlmsLink[] };

export type LlmsInput = {
  site: string;
  generatedAt: string;
  /** The plain source/date line (seo.ts sourceLine). */
  sourceLine: string;
  median: number | null;
  menus: number;
  locations: number;
  /** Priced restaurants with a pin on the map (the rest have no coordinates). */
  pins: number;
  p10: number | null;
  p90: number | null;
  boroughs: ReadonlyArray<{ name: string; slug: string; median: number | null; menus: number }>;
  cheapest: { restaurant: string; burger: string; price: number; where: string; path: string } | null;
  priciest: { restaurant: string; burger: string; price: number; where: string; path: string } | null;
  neighborhoods: { pages: number; ranked: number; top: { name: string; price: number; path: string } | null; bottom: { name: string; price: number; path: string } | null };
  csvPath: string;
  /** More link groups (for example the ranking pages), after "Pages". */
  sections?: readonly LlmsSection[];
};

const money = (v: number) => formatPrice(v, { cents: "always" });

function link(site: string, l: LlmsLink): string {
  const url = l.path === "/" ? site : `${site}${l.path}`;
  return `- [${l.title}](${url})${l.note ? `: ${l.note}` : ""}`;
}

export function llmsTxt(d: LlmsInput): string {
  const url = (path: string) => (path === "/" ? d.site : `${d.site}${path}`);
  const updated = formatDate(d.generatedAt);
  const lines: string[] = ["# The Burger Index", ""];
  lines.push(
    d.median !== null
      ? `> What a burger costs in New York City. The NYC Burger Index is ${money(d.median)}, the median burger price across ${pluralize(d.menus, "menu")} at ${pluralize(d.locations, "restaurant")}. Updated ${updated}.`
      : `> What a burger costs in New York City. No prices yet. Updated ${updated}.`,
    "",
    `${d.sourceLine} Prices are in US dollars, before tax and tip. We index prices, not quality.`,
    "",
  );

  if (d.median !== null) {
    lines.push(`## The numbers (${updated})`, "");
    lines.push(`- NYC Burger Index (median): ${money(d.median)}`);
    if (d.p10 !== null && d.p90 !== null) lines.push(`- Most prices fall between ${formatPrice(Math.floor(d.p10))} and ${formatPrice(Math.ceil(d.p90))}`);
    if (d.cheapest) lines.push(`- Cheapest burger: ${d.cheapest.burger} at [${d.cheapest.restaurant}](${url(d.cheapest.path)}), ${d.cheapest.where}, ${money(d.cheapest.price)}`);
    if (d.priciest) lines.push(`- Most expensive burger: ${d.priciest.burger} at [${d.priciest.restaurant}](${url(d.priciest.path)}), ${d.priciest.where}, ${money(d.priciest.price)}`);
    for (const b of d.boroughs) {
      if (b.median !== null) lines.push(`- ${b.name}: ${money(b.median)} median across ${pluralize(b.menus, "menu")} ([${b.name} burger prices](${url(`/boroughs/${b.slug}`)}))`);
    }
    const n = d.neighborhoods;
    if (n.top && n.bottom) {
      lines.push(`- Priciest of the ${n.ranked} ranked neighborhoods: [${n.top.name}](${url(n.top.path)}), ${money(n.top.price)} median`);
      lines.push(`- Cheapest of the ${n.ranked} ranked neighborhoods: [${n.bottom.name}](${url(n.bottom.path)}), ${money(n.bottom.price)} median`);
    }
    lines.push("");
  }

  lines.push("## Pages", "");
  const pages: LlmsLink[] = [
    { title: "The Burger Index", path: "/", note: "the NYC median, prices by borough and neighborhood, the cheapest and priciest burgers" },
    { title: "Every burger", path: "/burgers", note: `search and filter ${pluralize(d.locations, "priced burger")} by name, restaurant, neighborhood, borough and price` },
    {
      title: "Map",
      path: "/map",
      note:
        d.pins === d.locations
          ? `${pluralize(d.pins, "priced restaurant")} on a map, colored by price`
          : `${formatCount(d.pins)} of the ${pluralize(d.locations, "priced restaurant")} on a map, colored by price (the rest are listed below it)`,
    },
    { title: "Neighborhoods", path: "/neighborhoods", note: `${pluralize(d.neighborhoods.pages, "neighborhood")} with prices, ${d.neighborhoods.ranked} ranked by median` },
    { title: "The People's Price", path: "/peoples-price", note: "what visitors would pay for each burger, next to the menu price" },
    ...d.boroughs.map((b) => ({ title: `${b.name} burger prices`, path: `/boroughs/${b.slug}` })),
  ];
  lines.push(...pages.map((l) => link(d.site, l)), "");

  for (const s of d.sections ?? []) {
    if (!s.links.length) continue;
    lines.push(`## ${s.title}`, "", ...s.links.map((l) => link(d.site, l)), "");
  }

  lines.push(
    "## Data",
    "",
    link(d.site, {
      title: "Burger prices (CSV)",
      path: d.csvPath,
      note: "one row per priced restaurant: restaurant, neighborhood, borough, burger, price_usd, source, page_url, checked",
    }),
    "",
    "## Optional",
    "",
    link(d.site, { title: "Sitemap", path: "/sitemap.xml", note: "every page, including one per priced restaurant and neighborhood" }),
    "",
  );
  return lines.join("\n");
}
