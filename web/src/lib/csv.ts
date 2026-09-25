// The public price list, /data/burger-prices.csv (user decision 2026-09-25): one row per priced
// restaurant location, the columns below and nothing else (no ids, statuses, scrape notes or
// methodology). Pure: the route handler passes the priced restaurants, the site origin and the date.
import { formatIsoDay } from "./format";
import { PRICE_SOURCE_LABEL } from "./labels";
import type { PricedRestaurant } from "./schema";

export const CSV_PATH = "/data/burger-prices.csv";

/**
 * The CSV's license (user decision 2026-09-25): CC BY 4.0. Named in the Dataset JSON-LD, next to the CSV
 * link in llms.txt and after the footer's CSV link.
 */
export const CSV_LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;

export const CSV_COLUMNS = ["restaurant", "neighborhood", "borough", "burger", "price_usd", "source", "page_url", "checked"] as const;

/**
 * One RFC 4180 field: quoted when it holds a comma, a quote, a line break or edge spaces (quotes
 * doubled). A text cell starting with = + - @ or a tab/CR is what spreadsheets run as a formula, so
 * it gets a leading apostrophe (OWASP "CSV injection"); numbers are passed as numbers and never are.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(fields: readonly (string | number | null)[]): string {
  return fields.map(csvField).join(",");
}

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

/** The rows, as strings, in file order: by restaurant name, then borough, neighborhood and page. */
export function burgerPriceRows(restaurants: readonly PricedRestaurant[], opts: { site: string; generatedAt: string }): CsvRow[] {
  const checked = formatIsoDay(opts.generatedAt);
  return restaurants
    .map((r) => ({
      restaurant: r.name,
      neighborhood: r.neighborhood ?? "",
      borough: r.borough,
      burger: r.burger.name,
      price_usd: r.index_price.toFixed(2),
      source: PRICE_SOURCE_LABEL[r.price_source],
      page_url: `${opts.site}/restaurants/${r.id}`,
      checked,
    }))
    .sort(
      (a, b) =>
        a.restaurant.localeCompare(b.restaurant, "en") ||
        a.borough.localeCompare(b.borough, "en") ||
        a.neighborhood.localeCompare(b.neighborhood, "en") ||
        (a.page_url < b.page_url ? -1 : a.page_url > b.page_url ? 1 : 0),
    );
}

/** The whole file: a header line, then one line per row, CRLF line ends (RFC 4180), UTF-8 without a BOM. */
export function burgerPricesCsv(restaurants: readonly PricedRestaurant[], opts: { site: string; generatedAt: string }): string {
  const rows = burgerPriceRows(restaurants, opts);
  const lines = [csvLine(CSV_COLUMNS), ...rows.map((row) => csvLine(CSV_COLUMNS.map((c) => row[c])))];
  return `${lines.join("\r\n")}\r\n`;
}
