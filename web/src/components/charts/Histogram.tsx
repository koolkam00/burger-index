"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatPrice, pluralize } from "@/lib/format";
import { binFor } from "@/lib/price-bins";
import { binRangeLabel, histogram, niceTicks } from "@/lib/stats";
import { useElementSize, useMediaQuery, useSeenOnce } from "./hooks";

const TOP = 24; // median label band
const AXIS = 32; // x-axis band
const PAD_L = 34; // y tick labels
const PAD_R = 8;

function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0 || w <= 0) return "";
  const r = Math.min(4, w / 3, h);
  // Rounded data end (top), square baseline end.
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Distribution of restaurant index prices. $1 bins at ≥768px, $2 below. Bars take the price-ramp
 * color of their midpoint (vs the citywide median), so the chart doubles as the map legend.
 * One tab stop; ←/→ move between bars and show the same tooltip as hover.
 */
export function Histogram({
  prices,
  median,
  mark,
  labelledBy,
}: {
  /** Index prices, ascending. */
  prices: number[];
  /** Citywide median: bar colors are always measured against it. */
  median: number;
  /** The annotated median line (defaults to the citywide median). */
  mark?: { value: number; label: string };
  labelledBy: string;
}) {
  const wide = useMediaQuery("(min-width: 768px)", true);
  const width = wide ? 1 : 2;
  const bins = useMemo(() => histogram(prices, width, wide ? 10 : 6), [prices, width, wide]);
  const [plotRef, size] = useElementSize<HTMLDivElement>({ width: 1136, height: 376 });
  const [seenRef, seen] = useSeenOnce<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const liveId = useId();

  const W = Math.max(size.width, 200);
  const H = Math.max(size.height, 200);
  const plotH = H - TOP - AXIS;
  const x0 = PAD_L;
  const x1 = W - PAD_R;
  const lo = bins[0]?.lo ?? 0;
  const hi = bins[bins.length - 1]?.hi ?? 1;
  const xs = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const yTicks = niceTicks(maxCount, wide ? 4 : 3);
  const yMax = yTicks[yTicks.length - 1];
  const ys = (v: number) => TOP + plotH - (v / yMax) * plotH;
  const baseline = TOP + plotH;
  const xTicks: number[] = [];
  for (let v = Math.ceil(lo / 5) * 5; v <= hi; v += 5) xTicks.push(v);
  const stagger = Math.min(20, 240 / Math.max(1, bins.length));

  const markValue = mark?.value ?? median;
  const medX = xs(Math.min(Math.max(markValue, lo), hi));
  const medText = `${mark?.label ?? "NYC median"} ${formatPrice(markValue, { cents: "always" })}`;
  const medAnchor = medX < 90 ? "start" : medX > W - 90 ? "end" : "middle";

  const describe = (i: number) => {
    const b = bins[i];
    const mid = (b.lo + b.hi) / 2;
    return { value: pluralize(b.count, "restaurant"), context: `${binRangeLabel(b)} · ${binFor(mid, median).name}`, color: binFor(mid, median).color };
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < x0 || x > x1) return setActive(null);
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * bins.length)));
    setActive(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!bins.length) return;
    const cur = active ?? -1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(bins.length - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = cur < 0 ? 0 : Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = bins.length - 1;
    else if (e.key === "Escape") return setActive(null);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const tip = active !== null && bins[active] ? describe(active) : null;
  const tipX = active !== null && bins[active] ? (xs(bins[active].lo) + xs(bins[active].hi)) / 2 : 0;
  const tipY = active !== null && bins[active] ? ys(bins[active].count) : 0;

  return (
    <div ref={seenRef} className={`chart-grow ${seen ? "is-in" : ""}`}>
      <div
        ref={plotRef}
        className="hist-plot select-none"
        tabIndex={0}
        role="group"
        aria-roledescription="histogram"
        aria-labelledby={labelledBy}
        aria-describedby={liveId}
        onPointerMove={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? Math.max(0, bins.findIndex((b) => b.lo <= markValue && markValue < b.hi)))}
        onBlur={() => setActive(null)}
      >
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={labelledBy} className="block overflow-visible">
          {/* gridlines + y ticks */}
          {yTicks.map((t) => (
            <g key={t}>
              {t > 0 ? <line x1={x0} x2={x1} y1={ys(t)} y2={ys(t)} stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" /> : null}
              <text x={x0 - 8} y={ys(t)} dy="0.32em" textAnchor="end" className="t-num-s" fill="var(--ink-muted)">
                {t}
              </text>
            </g>
          ))}
          {/* bars */}
          {bins.map((b, i) => {
            const bx = xs(b.lo) + 1;
            const bw = Math.max(1, xs(b.hi) - xs(b.lo) - 2);
            const by = ys(b.count);
            const mid = (b.lo + b.hi) / 2;
            return (
              <path
                key={b.lo}
                className="hist-bar"
                d={barPath(bx, by, bw, baseline - by)}
                fill={binFor(mid, median).color}
                stroke={active === i ? "var(--ink)" : "none"}
                strokeWidth={active === i ? 1.5 : 0}
                style={{ ["--d" as string]: `${Math.round(i * stagger)}ms` }}
              />
            );
          })}
          {/* baseline */}
          <line x1={x0} x2={x1} y1={baseline} y2={baseline} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
          {/* x ticks */}
          {xTicks.map((v) => (
            <g key={v}>
              <line x1={xs(v)} x2={xs(v)} y1={baseline} y2={baseline + 4} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={xs(v)} y={baseline + 18} textAnchor="middle" className="t-num-s" fill="var(--ink-muted)">
                ${v}
              </text>
            </g>
          ))}
          {/* median annotation */}
          <line x1={medX} x2={medX} y1={TOP - 4} y2={baseline} stroke="var(--ink)" strokeWidth={2} />
          <text x={medX} y={TOP - 10} textAnchor={medAnchor} className="t-ui-s" style={{ fontWeight: 600 }} fill="var(--ink)">
            {medText}
          </text>
        </svg>

        {tip ? (
          <div
            className="tooltip"
            style={{
              left: Math.min(Math.max(tipX - 80, 0), W - 170),
              top: Math.max(0, tipY - 76),
            }}
            aria-hidden="true"
          >
            <span className="tooltip-key" style={{ background: tip.color }} />
            <p className="t-ui-m" style={{ fontWeight: 700 }}>
              {tip.value}
            </p>
            <p className="t-ui-s muted">{tip.context}</p>
          </div>
        ) : null}
        <p id={liveId} className="sr-only" aria-live="polite">
          {tip ? `${tip.value}, ${tip.context}` : "Use the left and right arrow keys to read each bar."}
        </p>
      </div>
    </div>
  );
}
