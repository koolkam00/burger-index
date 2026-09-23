// Formatting helpers shared by server and client components.

const TZ = "America/New_York";
export const MINUS = "−"; // true minus sign for deltas

const countFmt = new Intl.NumberFormat("en-US");
const centsFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

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
  const day = DATE_ONLY_STAMP.exec(iso);
  const d = new Date(day ? `${day[1]}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** "Sep 23, 2026, 3:05 PM EDT" in New York time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
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

/** "−30%" style signed percent for legends. */
export function formatSignedPct(pct: number): string {
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : MINUS}${Math.abs(pct)}%`;
}

/** Upper-cases the first letter, for a list or name that opens a sentence ("the Bronx" -> "The Bronx"). */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "$4.19–$6.50", or just "$4.19" when both ends print the same (one price, one day). */
export function formatSpan(lo: string, hi: string, sep = "–"): string {
  return lo === hi ? lo : `${lo}${sep}${hi}`;
}

export type Ends<T> = { kind: "none" } | { kind: "one"; top: T } | { kind: "tied"; top: T } | { kind: "spread"; top: T; bottom: T };

/**
 * How the ends of a list sorted priciest first can be described: nothing yet, a single item, every
 * item on the same price (to the cent), or a real top and bottom. Only the last one supports copy
 * like "X is the priciest; Y is the cheapest".
 */
export function ends<T>(sorted: readonly T[], price: (item: T) => number | null): Ends<T> {
  if (!sorted.length) return { kind: "none" };
  const top = sorted[0];
  if (sorted.length === 1) return { kind: "one", top };
  const bottom = sorted[sorted.length - 1];
  const cents = (item: T) => Math.round((price(item) ?? 0) * 100);
  return cents(top) === cents(bottom) ? { kind: "tied", top } : { kind: "spread", top, bottom };
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
