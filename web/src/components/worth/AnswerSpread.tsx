"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";
import { formatCount, formatPrice } from "@/lib/format";
import { axisPosition, bucketAnswers, bucketIndex, formatDollars, histRange, type Hist } from "@/lib/worth";

/** Axis labels under the plot: the ends and two stops between (all $5 bucket edges). */
const TICKS = [5, 25, 50, 75];

/**
 * The compact answer distribution (DESIGN.md "Answer distribution"): how many visitors gave each
 * $5 range, $5 to $75, as flat driftwood bars, with a 2px ink line at the menu price (pinned to an
 * end when the price is off the axis) and the visitor's own range in ink. A <figure> with a title, a
 * one-line takeaway and a "View as table" toggle; the plot is one image to assistive tech, the table
 * carries every number.
 */
export function AnswerSpread({ id, hist, price, mine }: { id: string; hist: Hist; price: number; mine: number | null }) {
  const [asTable, setAsTable] = useState(false);
  const buckets = bucketAnswers(hist);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const range = histRange(hist);
  const mineBucket = mine !== null ? bucketIndex(mine) : null;
  const pos = axisPosition(price);
  const anchor = pos < 0.2 ? "start" : pos > 0.8 ? "end" : "middle";
  const takeaway = !range
    ? "No answers yet."
    : range.lo === range.hi
      ? `Every answer is ${formatDollars(range.lo)}.`
      : `Answers run from ${formatDollars(range.lo)} to ${formatDollars(range.hi)}.`;
  const menuLabel = `Menu ${formatPrice(price, { cents: "always" })}`;

  return (
    <figure className="worth-spread" aria-labelledby={`${id}-title`}>
      <figcaption className="worth-spread-cap">
        <div className="min-w-0">
          <p id={`${id}-title`} className="t-ui-m font-bold">
            What people would pay
          </p>
          <p id={`${id}-desc`} className="t-ui-s muted mt-0.5">
            {takeaway}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm -mx-3 no-print" onClick={() => setAsTable((v) => !v)}>
          {asTable ? <ChartColumn strokeWidth={2} aria-hidden="true" /> : <Table2 strokeWidth={2} aria-hidden="true" />}
          {asTable ? "View as chart" : "View as table"}
        </button>
      </figcaption>

      <div hidden={asTable}>
        <div className="spread-plot" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
          {/* The label band: the menu-price marker's label only. */}
          <div className="spread-band" aria-hidden="true">
            <span
              className="spread-mark-label t-ui-s"
              style={
                anchor === "start"
                  ? { left: `${pos * 100}%`, marginLeft: -1 }
                  : anchor === "end"
                    ? { right: `${(1 - pos) * 100}%`, marginRight: -1 }
                    : { left: `${pos * 100}%`, transform: "translateX(-50%)" }
              }
            >
              {menuLabel}
            </span>
          </div>
          <div className="spread-bars" aria-hidden="true">
            {buckets.map((b) => (
              <span key={b.index} className="spread-col">
                {b.count > 0 ? <span className={`spread-bar ${b.index === mineBucket ? "is-mine" : ""}`} style={{ height: `${(b.count / max) * 100}%` }} /> : null}
              </span>
            ))}
            <span className="spread-mark" style={{ left: `calc(${pos} * (100% - 2px))` }} />
          </div>
          <div className="spread-axis t-num-s muted" aria-hidden="true">
            {TICKS.map((t, i) => (
              <span
                key={t}
                style={
                  i === 0
                    ? { left: 0 }
                    : i === TICKS.length - 1
                      ? { right: 0 }
                      : { left: `${axisPosition(t) * 100}%`, transform: "translateX(-50%)" }
                }
              >
                {formatDollars(t)}
              </span>
            ))}
          </div>
        </div>
        {mineBucket !== null ? (
          <p className="spread-key t-ui-s muted">
            <span className="spread-key-swatch" aria-hidden="true" />
            Your answer&apos;s range
          </p>
        ) : null}
      </div>

      <div hidden={!asTable}>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Answer</th>
                <th scope="col" className="num">
                  Answers
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => b.count > 0)
                .map((b) => (
                  <tr key={b.index}>
                    <th scope="row">
                      {b.label}
                      {b.index === mineBucket ? <span className="muted"> · yours</span> : null}
                    </th>
                    <td className="num">{formatCount(b.count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  );
}
