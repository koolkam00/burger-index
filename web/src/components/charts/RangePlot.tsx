// Dot-and-range plot for neighborhoods (DESIGN.md "Neighborhood plot"): a 10px --ink dot at the
// median, a 2px --axis line from index_min to index_max, 28px rows sorted by median.
import Link from "next/link";
import { formatCount, formatPrice, formatSpan } from "@/lib/format";
import type { AreaWithMenus } from "@/lib/menus";
import { BoroughDot } from "../ui";

export function RangePlot({ areas, cityMedian, labelledBy }: { areas: AreaWithMenus[]; cityMedian: number | null; labelledBy: string }) {
  const rows = areas.filter((a) => a.index_median !== null && a.index_min !== null && a.index_max !== null);
  if (!rows.length) return null;
  const lo = Math.max(0, Math.floor(Math.min(...rows.map((a) => a.index_min as number), cityMedian ?? Infinity) / 5) * 5);
  const hi = Math.ceil(Math.max(...rows.map((a) => a.index_max as number), cityMedian ?? 0) / 5) * 5 || lo + 5;
  const span = Math.max(hi - lo, 5);
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;
  const step = span > 40 ? 10 : 5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= lo + span; v += step) ticks.push(v);

  return (
    <div role="img" aria-labelledby={labelledBy}>
      <div aria-hidden="true" className="grid grid-cols-[minmax(0,42%)_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
        {/* top axis */}
        <div />
        <div className="relative h-6">
          {ticks.map((t) => (
            // Centered on its gridline, except a tick at either end of the axis, which aligns inward
            // so it never runs into the name column or the "Median" head.
            <span
              key={t}
              className={`t-num-s muted absolute bottom-1 whitespace-nowrap ${t <= lo ? "" : t >= lo + span ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: pct(t) }}
            >
              ${t}
            </span>
          ))}
        </div>
        <div className="t-label muted text-right">Median</div>
        {rows.map((a) => (
          <div key={a.slug} className="contents">
            <div className="t-ui-s flex min-h-7 min-w-0 items-center gap-2 py-1">
              <BoroughDot borough={a.borough} />
              <span className="break-anywhere leading-tight">
                <Link href={`/neighborhoods/${a.slug}`} tabIndex={-1} className="ui-link">
                  {a.name}
                </Link>
              </span>
            </div>
            <div className="relative h-7 self-stretch">
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 bottom-0 w-px" style={{ left: pct(t), background: "var(--grid)" }} />
              ))}
              {cityMedian !== null ? <span className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: pct(cityMedian) }} /> : null}
              <span
                className="absolute top-1/2 h-0.5 -translate-y-1/2"
                style={{ left: pct(a.index_min as number), width: `calc(${pct(a.index_max as number)} - ${pct(a.index_min as number)})`, background: "var(--axis)" }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
                style={{ left: pct(a.index_median as number), boxShadow: "0 0 0 2px var(--surface)" }}
              />
            </div>
            <div className="t-num-m text-right">{formatPrice(a.index_median, { cents: "always" })}</div>
          </div>
        ))}
      </div>
      {cityMedian !== null ? (
        <p className="t-ui-s muted mt-3 flex items-center gap-2" aria-hidden="true">
          <span className="inline-block h-3 w-px bg-ink" /> NYC median {formatPrice(cityMedian, { cents: "always" })}
          <span className="ml-3 inline-block h-0.5 w-4" style={{ background: "var(--axis)" }} /> cheapest to priciest index price
          <span className="ml-3 inline-block size-2.5 rounded-full bg-ink" /> median
        </p>
      ) : null}
    </div>
  );
}

export function AreaTable({ areas }: { areas: AreaWithMenus[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Neighborhood</th>
          <th scope="col" className="num">
            Median
          </th>
          <th scope="col" className="num hidden sm:table-cell">
            Range
          </th>
          <th scope="col" className="num">
            Menus
          </th>
        </tr>
      </thead>
      <tbody>
        {areas.map((a) => (
          <tr key={a.slug}>
            <th scope="row" className="break-anywhere">
              <Link href={`/neighborhoods/${a.slug}`} className="ui-link">
                {a.name}
              </Link>
              <span className="t-ui-s muted block">{a.borough}</span>
            </th>
            <td className="num">{formatPrice(a.index_median, { cents: "always" })}</td>
            <td className="num hidden sm:table-cell">
              {a.index_min !== null ? formatSpan(formatPrice(a.index_min, { cents: "always" }), formatPrice(a.index_max, { cents: "always" })) : "—"}
            </td>
            <td className="num">{formatCount(a.menuCounts.menus)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
