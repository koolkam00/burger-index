// schema.org JSON-LD for the static pages (Next 16 guide "JSON-LD": a plain <script type="application/ld+json">
// in the page, the payload escaped so data can never close the tag). Pure: every builder takes the
// site origin and plain values, so the tests can check the shapes without a build.
//
// Rules (user decisions 2026-09-25): the markup restates what the page shows (names, prices, links),
// never more; the People's Price (visitors' answers) is never marked up as a Review, Rating or
// AggregateRating; no license on the Dataset until the user picks one.
import { SITE_NAME } from "./site";

/** Any JSON-LD node. */
export type JsonLdNode = { "@type": string; [key: string]: unknown };

const CONTEXT = "https://schema.org";

/** `site` + `path` (a path starting with "/", or "" / "/" for the home page, which is the bare origin). */
export function siteUrl(site: string, path: string): string {
  return path === "/" || path === "" ? site : `${site}${path}`;
}

/**
 * The script body for one JSON-LD document. JSON.stringify leaves "<", ">" and "&" alone, so a name
 * holding "</script>" would end the tag; they are written as JSON unicode escapes (backslash-u003c and
 * so on), the same string once parsed. U+2028 and U+2029 are escaped too.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** One JSON-LD document for a page: a single node as is, several in an @graph. */
export function jsonLdDocument(nodes: readonly (JsonLdNode | null | undefined | false)[]): Record<string, unknown> | null {
  const list = nodes.filter((n): n is JsonLdNode => Boolean(n));
  if (!list.length) return null;
  if (list.length === 1) return { "@context": CONTEXT, ...list[0] };
  return { "@context": CONTEXT, "@graph": list };
}

// ---- the site ------------------------------------------------------------------------------------

export const organizationId = (site: string) => `${site}/#organization`;
export const websiteId = (site: string) => `${site}/#website`;

export function organizationNode(site: string): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": organizationId(site),
    name: SITE_NAME,
    url: site,
    logo: `${site}/icon.svg`,
  };
}

export function websiteNode(site: string, description: string): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": websiteId(site),
    name: SITE_NAME,
    url: site,
    description,
    inLanguage: "en-US",
    publisher: { "@id": organizationId(site) },
  };
}

/** The public CSV as a schema.org Dataset (no license: the user has not chosen one). */
export function datasetNode(
  site: string,
  d: { name: string; description: string; csvPath: string; generatedAt: string; month: string; keywords?: readonly string[] },
): JsonLdNode {
  return {
    "@type": "Dataset",
    "@id": `${site}/#dataset`,
    name: d.name,
    description: d.description,
    url: site,
    creator: { "@type": "Organization", "@id": organizationId(site), name: SITE_NAME, url: site },
    publisher: { "@id": organizationId(site) },
    dateModified: d.generatedAt,
    temporalCoverage: d.month,
    spatialCoverage: { "@type": "Place", name: "New York City" },
    isAccessibleForFree: true,
    ...(d.keywords?.length ? { keywords: [...d.keywords] } : {}),
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: siteUrl(site, d.csvPath),
      },
    ],
  };
}

// ---- navigation ----------------------------------------------------------------------------------

export type Crumb = { href?: string; label: string };

/**
 * BreadcrumbList from the page's crumbs (the visible breadcrumbs where the page shows them). The last
 * crumb is the page itself: without an href it points at `pagePath`.
 */
export function breadcrumbNode(site: string, crumbs: readonly Crumb[], pagePath: string): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: siteUrl(site, c.href ?? pagePath),
    })),
  };
}

export type ListEntry = { name: string; path: string };

/** An ordered list of pages (a ranking or a cheapest-first list), each entry linking to its page. */
export function itemListNode(site: string, list: { name: string; entries: readonly ListEntry[]; order?: "ascending" | "descending" }): JsonLdNode {
  return {
    "@type": "ItemList",
    name: list.name,
    ...(list.order ? { itemListOrder: list.order === "ascending" ? "https://schema.org/ItemListOrderAscending" : "https://schema.org/ItemListOrderDescending" } : {}),
    numberOfItems: list.entries.length,
    itemListElement: list.entries.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: e.name,
      url: siteUrl(site, e.path),
    })),
  };
}

// ---- restaurants ---------------------------------------------------------------------------------

/** Money as schema.org wants it: a plain decimal string with a dot ("15.99", "20.00"). */
export function offerPrice(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export type RestaurantInput = {
  path: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  borough: string;
  lat: number | null;
  lng: number | null;
  website: string | null;
  menuUrl: string | null;
  burger: { name: string; description: string | null };
  price: number;
};

/**
 * A priced restaurant: its address and coordinates, and its one published burger as a menu item with
 * an Offer (price in USD). `url` is this page; the restaurant's own site goes in sameAs.
 */
export function restaurantNode(site: string, r: RestaurantInput): JsonLdNode {
  const url = siteUrl(site, r.path);
  return {
    "@type": "Restaurant",
    "@id": `${url}#restaurant`,
    name: r.name,
    url,
    ...(r.website ? { sameAs: [r.website] } : {}),
    address: {
      "@type": "PostalAddress",
      ...(r.address ? { streetAddress: r.address } : {}),
      addressLocality: r.borough,
      addressRegion: "NY",
      addressCountry: "US",
    },
    ...(r.neighborhood ? { containedInPlace: { "@type": "Place", name: `${r.neighborhood}, ${r.borough}` } } : {}),
    ...(r.lat !== null && r.lng !== null ? { geo: { "@type": "GeoCoordinates", latitude: r.lat, longitude: r.lng } } : {}),
    hasMenu: {
      "@type": "Menu",
      ...(r.menuUrl ? { url: r.menuUrl } : {}),
      hasMenuItem: {
        "@type": "MenuItem",
        name: r.burger.name,
        ...(r.burger.description ? { description: r.burger.description } : {}),
        offers: {
          "@type": "Offer",
          price: offerPrice(r.price),
          priceCurrency: "USD",
        },
      },
    },
  };
}
