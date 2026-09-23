// Horizontal bars for the five boroughs (DESIGN.md "Borough bars"): start at $0, sorted high → low,
// 20px bars in 36px rows, neutral --bar fill (current borough in --ink), value at the tip, and a
// 1px --ink reference line for the citywide median labeled "NYC".
import Link from "next/link";
import type { BoroughEntry } from "@/lib/data";
import { formatCount, formatPrice } from "@/lib/format";
import { BoroughDot } from "../ui";
import { GrowOnView } from "./GrowOnView";

export function BoroughBars({ boroughs, cityMedian, current, labelledBy }: { boroughs: BoroughEntry[]; cityMedian: number | null; current?: string; labelledBy: string }) {
  const priced = boroughs.filter((b) => b.summary?.index_median !== null && b.summary?.index_median !== undefined);
  const unpriced = boroughs.filter((b) => !priced.includes(b));
  const sorted = [...priced].sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  const max = Math.max(cityMedian ?? 0, ...sorted.map((b) => b.summary!.index_median as number), 1);
  const domain = max * 1.22; // room for the value label at the tip
  const pct = (v: number) => `${(v / domain) * 100}%`;

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
            return (
              <div key={b.slug} className={`borough-row contents ${current === b.slug ? "is-current" : ""}`}>
                <div className="t-ui-m flex h-9 min-w-0 items-center gap-2 pr-3">
                  <BoroughDot borough={b.name} />
                  <Link href={`/boroughs/${b.slug}`} tabIndex={-1} className="ui-link truncate">
                    {b.name}
                  </Link>
                </div>
                <div className="relative h-9">
                  <div
                    className="hbar-fill absolute top-2 left-0 h-5 rounded-r-[3px]"
                    style={{ width: pct(v), ["--d" as string]: `${i * 40}ms` }}
                  />
                  <span className="t-num-m absolute top-1/2 -translate-y-1/2 pl-2 whitespace-nowrap" style={{ left: pct(v) }}>
                    {formatPrice(v, { cents: "always" })}
                  </span>
                  {cityMedian !== null ? <span className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: pct(cityMedian) }} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </GrowOnView>
      {unpriced.length ? (
        <p className="t-ui-s muted mt-3">No priced restaurants yet in {unpriced.map((b) => b.name).join(", ")}.</p>
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
          <th scope="col" className="num">
            Range
          </th>
          <th scope="col" className="num">
            Priced
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
            </th>
            <td className="num">{formatPrice(b.summary?.index_median ?? null, { cents: "always" })}</td>
            <td className="num">
              {b.summary?.index_min != null ? `${formatPrice(b.summary.index_min, { cents: "always" })}–${formatPrice(b.summary.index_max, { cents: "always" })}` : "—"}
            </td>
            <td className="num">{formatCount(b.summary?.restaurants_priced ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
