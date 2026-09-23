// Small statistics helpers for charts (client-safe).

/** Linear interpolation between closest ranks (numpy default; same as pipeline/build.py). */
export function percentile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(sorted: readonly number[]): number | null {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export type HistBin = {
  /** Inclusive lower edge in dollars (the first bin is open below). */
  lo: number;
  /** Exclusive upper edge in dollars (the last bin is open above). */
  hi: number;
  count: number;
  openLow: boolean;
  openHigh: boolean;
};

/**
 * DESIGN.md histogram: bins of `width` dollars across p1..p99, end bins open ("≤ $X", "$Y+").
 * The domain is widened around the median when the data is very tight, so a degenerate
 * distribution still draws as a readable chart.
 */
export function histogram(sortedPrices: readonly number[], width: number, minBins = 8): HistBin[] {
  if (!sortedPrices.length) return [];
  const p1 = percentile(sortedPrices, 0.01) ?? sortedPrices[0];
  const p99 = percentile(sortedPrices, 0.99) ?? sortedPrices[sortedPrices.length - 1];
  let lo = Math.floor(p1 / width) * width;
  let hi = Math.max(Math.ceil(p99 / width) * width, lo + width);
  if (hi === p99) hi += width; // keep p99 inside a closed bin
  while ((hi - lo) / width < minBins) {
    if (lo - width >= 0) lo -= width;
    if ((hi - lo) / width < minBins) hi += width;
  }
  const n = Math.round((hi - lo) / width);
  const bins: HistBin[] = Array.from({ length: n }, (_, i) => ({
    lo: lo + i * width,
    hi: lo + (i + 1) * width,
    count: 0,
    openLow: i === 0,
    openHigh: i === n - 1,
  }));
  for (const p of sortedPrices) {
    let i = Math.floor((p - lo) / width);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    bins[i].count += 1;
  }
  return bins;
}

/** 3–5 "clean" ticks from 0 to at least `max` (0, 5, 10… / 0, 25, 50…). */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10].map((s) => s * mag).filter((s) => s >= 1 || mag < 1);
  const step = steps.find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
