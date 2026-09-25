// DESIGN.md price ramp "Shallows to Trench" (one sea hue, pale to deep: the deeper the water, the
// pricier the burger): five bins measured against the CITYWIDE index median,
// never a filtered subset, so a mark keeps its color when filters change.
// Comparisons run in integer cents so the legend ranges and the bin assignment always agree.

import { formatPrice, MINUS } from "./format";

export type PriceStep = 1 | 2 | 3 | 4 | 5;

export type PriceBin = {
  step: PriceStep;
  key: "steal" | "deal" | "going" | "pricey" | "splurge";
  name: string;
  /** CSS custom property holding the ramp color. */
  color: string;
};

export const PRICE_BINS: readonly PriceBin[] = [
  { step: 1, key: "steal", name: "Steal", color: "var(--price-1)" },
  { step: 2, key: "deal", name: "Deal", color: "var(--price-2)" },
  { step: 3, key: "going", name: "Going rate", color: "var(--price-3)" },
  { step: 4, key: "pricey", name: "Pricey", color: "var(--price-4)" },
  { step: 5, key: "splurge", name: "Splurge", color: "var(--price-5)" },
];

const cents = (x: number) => Math.round(x * 100);

/** Bin for a price relative to the citywide median `m`. */
export function binFor(price: number, median: number): PriceBin {
  const p = cents(price) * 100;
  const m = cents(median);
  if (p <= 70 * m) return PRICE_BINS[0];
  if (p <= 85 * m) return PRICE_BINS[1];
  if (p < 115 * m) return PRICE_BINS[2];
  if (p < 130 * m) return PRICE_BINS[3];
  return PRICE_BINS[4];
}

export type BinRange = PriceBin & {
  /** Lowest / highest price (in dollars) that lands in the bin; null for an open end. */
  min: number | null;
  max: number | null;
  /** "≤ $11.55", "$11.56–$14.02", "$21.45+" */
  dollars: string;
  /** "−30%", "−30% to −15%", "±15%", "+15% to +30%", "+30%" */
  percent: string;
};

/** Dollar thresholds for the legend: "Steal · ≤ $11.55 (−30%)". */
export function binRanges(median: number): BinRange[] {
  const m = cents(median);
  // Largest price in cents with p*100 <= k*m is floor(k*m/100); smallest with p*100 > k*m is that + 1.
  const le = (k: number) => Math.floor((k * m) / 100);
  const lt = (k: number) => Math.ceil((k * m) / 100) - 1;
  const bounds: Array<[number | null, number | null]> = [
    [null, le(70)],
    [le(70) + 1, le(85)],
    [le(85) + 1, lt(115)],
    [lt(115) + 1, lt(130)],
    [lt(130) + 1, null],
  ];
  const pct = [`${MINUS}30%`, `${MINUS}30% to ${MINUS}15%`, "±15%", "+15% to +30%", "+30%"];
  return PRICE_BINS.map((bin, i) => {
    const [lo, hi] = bounds[i];
    const min = lo === null ? null : lo / 100;
    const max = hi === null ? null : hi / 100;
    let dollars: string;
    if (min === null) dollars = `≤ ${formatPrice(max, { cents: "always" })}`;
    else if (max === null) dollars = `${formatPrice(min, { cents: "always" })}+`;
    else dollars = `${formatPrice(min, { cents: "always" })}–${formatPrice(max, { cents: "always" })}`;
    return { ...bin, min, max, dollars, percent: pct[i] };
  });
}
