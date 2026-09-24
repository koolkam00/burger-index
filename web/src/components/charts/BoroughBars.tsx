// Horizontal bars for the five boroughs (DESIGN.md "Borough bars"): start at $0, sorted high → low,
// 20px bars in 36px rows, neutral --bar fill (current borough in --ink), value at the tip, and a
// 1px --ink reference line for the citywide median labeled "NYC". A borough priced only from chain
// menus says "Chain prices only" under its name: its bar is a chain median, not a like-for-like one.
import Link from "next/link";
import type { BoroughEntry } from "@/lib/data";
import { boroughInProse } from "@/lib/boroughs";
import { formatCount, formatPrice } from "@/lib/format";
import { isChainOnly, joinList, menuBreakdownShort } from "@/lib/menus";
import { BoroughDot } from "../ui";
import { GrowOnView } from "./GrowOnView";

export function BoroughBars({ boroughs, cityMedian, current, labelledBy }: { boroughs: BoroughEntry[]; cityMedian: number | null; current?: string; labelledBy: string }) {
  const priced = boroughs.filter((b) => b.summary?.index_median !== null && b.summary?.index_median !== undefined);
  const unpriced = boroughs.filter((b) => !priced.includes(b));
  const sorted = [...priced].sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  const max = Math.max(cityMedian ?? 0, ...sorted.map((b) => b.summary!.index_median as number), 1);
  // Bars share the plot width minus room for the value label, so the label at the tip never lands
  // on the longest bar, even on a 375px screen.
  const pct = (v: number) => `calc((100% - 4.5rem) * ${v / max})`;

  return (
    <div role="img" aria-labelledby={labelledBy}>
      <GrowOnView>
        <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]" aria-hidden="true">
          {/* header row: NYC reference label */}
          <div />
          <div className="relative h-6">
            {cityMedian !== null ? (
              <span className="t-ui-s absolute bottom-1 -translate-x-1/2 font-semibold whitespace-nowrap" style={{ left: pct(cityMedian) }}>
                NYC {formatPrice(cityMedian, { cents: "always" })}
              </span>
            ) : null}
          </div>
          {sorted.map((b, i) => {
            const v = b.summary!.index_median as number;
            const chainOnly = isChainOnly(b.menuCounts);
            return (
              <div key={b.slug} className={`borough-row contents ${current === b.slug ? "is-current" : ""}`}>
                <div className="flex min-h-9 min-w-0 flex-col justify-center py-0.5 pr-3">
                  <div className="t-ui-m flex min-w-0 items-center gap-2">
                    <BoroughDot borough={b.name} />
                    <Link href={`/boroughs/${b.slug}`} tabIndex={-1} className="ui-link truncate">
                      {b.name}
                    </Link>
                  </div>
                  {chainOnly ? <span className="t-ui-s muted pl-[18px] leading-tight">Chain prices only</span> : null}
                </div>
                <div className="relative min-h-9">
                  <div
                    className="hbar-fill absolute top-[calc(50%-10px)] left-0 h-5 rounded-r-[3px]"
                    style={{ width: pct(v), ["--d" as string]: `${i * 40}ms` }}
                  />
                  {/* The NYC line first, so a value label that lands on it paints over it: the label's
                      --bg knockout breaks the line instead of the line cutting through a digit. */}
                  {cityMedian !== null ? <span className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: pct(cityMedian) }} /> : null}
                  <span className="t-num-m absolute top-1/2 -translate-y-1/2 bg-bg pr-1 pl-2 whitespace-nowrap" style={{ left: pct(v) }}>
                    {formatPrice(v, { cents: "always" })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </GrowOnView>
      {unpriced.length ? (
        <p className="t-ui-s muted mt-3">No priced restaurants yet in {joinList(unpriced.map((b) => boroughInProse(b.name)))}.</p>
      ) : null}
    </div>
  );
}

export function BoroughTable({ boroughs }: { boroughs: BoroughEntry[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Borough</th>
          <th scope="col" className="num">
            Median
          </th>
          <th scope="col" className="num hidden sm:table-cell">
            Range
          </th>
          <th scope="col" className="num">
            Menus
          </th>
          <th scope="col" className="num hidden sm:table-cell">
            Locations
          </th>
        </tr>
      </thead>
      <tbody>
        {boroughs.map((b) => (
          <tr key={b.slug}>
            <th scope="row">
              <span className="inline-flex items-center gap-2">
                <BoroughDot borough={b.name} />
                {b.name}
              </span>
              {b.menuCounts.menus ? <span className="t-ui-s muted block">{isChainOnly(b.menuCounts) ? "Chain prices only" : menuBreakdownShort(b.menuCounts)}</span> : null}
            </th>
            <td className="num">{formatPrice(b.summary?.index_median ?? null, { cents: "always" })}</td>
            <td className="num hidden sm:table-cell">
              {b.summary?.index_min != null ? `${formatPrice(b.summary.index_min, { cents: "always" })}–${formatPrice(b.summary.index_max, { cents: "always" })}` : "—"}
            </td>
            <td className="num">{formatCount(b.menuCounts.menus)}</td>
            <td className="num hidden sm:table-cell">{formatCount(b.summary?.restaurants_priced ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
