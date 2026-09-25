// Formatting helpers shared by server and client components.

const TZ = "America/New_York";
export const MINUS = "−"; // true minus sign for deltas

const countFmt = new Intl.NumberFormat("en-US");
const centsFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });

export type CentsMode = "always" | "auto";

/**
 * "$12.50" / "$12". `cents: "auto"` drops ".00" (prose, headings); `cents: "always"` keeps two
 * decimals (tables, chips, tooltips: DESIGN.md "Money format").
 */
export function formatPrice(value: number | null | undefined, opts: { cents?: CentsMode; empty?: string } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return opts.empty ?? "—";
  const cents = Math.round(value * 100);
  const mode = opts.cents ?? "auto";
  if (mode === "auto" && cents % 100 === 0) return `$${countFmt.format(cents / 100)}`;
  return `$${centsFmt.format(cents / 100)}`;
}

/** Dollars and cents as strings, for price-card display ("16", "50"). */
export function priceParts(value: number): { dollars: string; cents: string } {
  const cents = Math.round(value * 100);
  return { dollars: countFmt.format(Math.floor(cents / 100)), cents: String(cents % 100).padStart(2, "0") };
}

export function formatCount(n: number): string {
  return countFmt.format(n);
}

// A stamp at exactly midnight UTC carries a day, not a time: hand checks record the day the menu
// was re-read as "<YYYY-MM-DD>T00:00:00Z" (pipeline/corrections.py). Shown in New York time, that
// would be 8 PM the evening before.
const DATE_ONLY_STAMP = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00))?$/;

/**
 * "Sep 23, 2026" in New York time. A bare date ("2026-09-23") or a midnight-UTC stamp
 * ("2026-09-23T00:00:00Z") is a calendar day and prints as that day.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = stampDate(iso);
  return d ? dateFmt.format(d) : "—";
}

const monthYearFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" });
const monthYearShortFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", year: "numeric" });
const isoDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function stampDate(iso: string): Date | null {
  const day = DATE_ONLY_STAMP.exec(iso);
  const d = new Date(day ? `${day[1]}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "September 2026" (`short`: "Sep 2026") in New York time, for "Updated …" copy, titles and descriptions. */
export function formatMonthYear(iso: string, opts: { short?: boolean } = {}): string {
  const d = stampDate(iso);
  return d ? (opts.short ? monthYearShortFmt : monthYearFmt).format(d) : "—";
}

/** "2026-09-25": the New York calendar day of a stamp (the CSV's `checked` column, JSON-LD dates). */
export function formatIsoDay(iso: string): string {
  const d = stampDate(iso);
  return d ? isoDayFmt.format(d) : "";
}

/** Percent difference of `value` from `base` (e.g. 12.3 for +12.3%). */
export function pctDiff(value: number, base: number): number {
  return ((value - base) / base) * 100;
}

/** "+12%", "−8%", or "at median" when |Δ| < 0.5%. */
export function formatDelta(value: number | null, base: number | null, opts: { suffix?: string; atLabel?: string } = {}): string {
  if (value === null || base === null || base === 0) return "—";
  const pct = pctDiff(value, base);
  if (Math.abs(pct) < 0.5) return opts.atLabel ?? "at median";
  const rounded = Math.round(Math.abs(pct));
  const text = `${pct > 0 ? "+" : MINUS}${rounded}%`;
  return opts.suffix ? `${text} ${opts.suffix}` : text;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "$4.19–$6.50", or just "$4.19" when both ends print the same (one price, one day). */
export function formatSpan(lo: string, hi: string, sep = "–"): string {
  return lo === hi ? lo : `${lo}${sep}${hi}`;
}

/**
 * The top and bottom of a list sorted priciest first, when they differ (to the cent): only then is
 * copy like "X is the priciest; Y is the cheapest" true. Null for an empty list, a single item, or
 * every item on the same price.
 */
export function spreadEnds<T>(sorted: readonly T[], price: (item: T) => number | null): { top: T; bottom: T } | null {
  if (sorted.length < 2) return null;
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const cents = (item: T) => Math.round((price(item) ?? 0) * 100);
  return cents(top) === cents(bottom) ? null : { top, bottom };
}

/** Hostname without "www.", for link labels. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links are rendered as anchors. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
