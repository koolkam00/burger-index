"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BOROUGH_META } from "@/lib/boroughs";
import { formatCount, formatDelta, formatPrice, formatSpan } from "@/lib/format";
import { menuBreakdownShort, type AreaWithMenus } from "@/lib/menus";
import type { Borough } from "@/lib/schema";
import { BoroughDot } from "./ui";

type Key = "median" | "name" | "menus" | "range";
type Dir = "asc" | "desc";
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sortable ranking of neighborhoods with enough distinct priced menus. Keyboard-operable headers. */
export function NeighborhoodRanking({ areas, cityMedian }: { areas: AreaWithMenus[]; cityMedian: number | null }) {
  const [key, setKey] = useState<Key>("median");
  const [dir, setDir] = useState<Dir>("desc");
  const [boroughs, setBoroughs] = useState<Borough[]>([]);

  const rankByMedian = useMemo(() => {
    const sorted = [...areas].sort((a, b) => (b.index_median ?? 0) - (a.index_median ?? 0) || collator.compare(a.name, b.name));
    return new Map(sorted.map((a, i) => [a.slug, i + 1]));
  }, [areas]);

  const rows = useMemo(() => {
    const filtered = boroughs.length ? areas.filter((a) => boroughs.includes(a.borough)) : areas;
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let d = 0;
      if (key === "name") d = collator.compare(a.name, b.name);
      else if (key === "menus") d = a.menuCounts.menus - b.menuCounts.menus;
      else if (key === "range") d = (a.index_max ?? 0) - (a.index_min ?? 0) - ((b.index_max ?? 0) - (b.index_min ?? 0));
      else d = (a.index_median ?? 0) - (b.index_median ?? 0);
      return d * sign || collator.compare(a.name, b.name);
    });
  }, [areas, boroughs, key, dir]);

  const lo = Math.min(...areas.map((a) => a.index_min ?? Infinity));
  const hi = Math.max(...areas.map((a) => a.index_max ?? 0));
  const span = Math.max(hi - lo, 1);
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;

  const header = (k: Key, label: string, className = "", defaultDir: Dir = "desc") => {
    const active = key === k;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        <button
          type="button"
          className="sort-btn"
          onClick={() => {
            if (active) setDir(dir === "asc" ? "desc" : "asc");
            else {
              setKey(k);
              setDir(defaultDir);
            }
          }}
        >
          {label}
          <Icon strokeWidth={2} aria-hidden="true" className={active ? "" : "opacity-60"} />
        </button>
      </th>
    );
  };

  const present = BOROUGH_META.filter((m) => areas.some((a) => a.borough === m.name));

  return (
    <div>
      {present.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by borough">
          {present.map((m) => {
            const on = boroughs.includes(m.name);
            return (
              <button
                key={m.slug}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => setBoroughs(on ? boroughs.filter((b) => b !== m.name) : [...boroughs, m.name])}
              >
                <BoroughDot borough={m.name} />
                {m.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="table-shell">
      <table className="data-table">
        <caption className="sr-only">Neighborhoods ranked by median index price. Column headers sort the table.</caption>
        <thead>
          <tr>
            <th scope="col" className="num hidden w-12 sm:table-cell">
              Rank
            </th>
            {header("name", "Neighborhood", "", "asc")}
            {header("median", "Median", "num")}
            {header("range", "Range", "hidden md:table-cell")}
            {header("menus", "Menus", "num hidden sm:table-cell")}
            <th scope="col" className="num hidden lg:table-cell">
              vs NYC
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.slug}>
              <td className="num t-num-s muted hidden sm:table-cell">{rankByMedian.get(a.slug)}</td>
              <th scope="row" className="min-w-0">
                <Link href={`/neighborhoods/${a.slug}`} className="ui-link break-anywhere font-semibold">
                  {a.name}
                </Link>
                <span className="t-ui-s muted flex flex-wrap items-center gap-x-1.5">
                  <BoroughDot borough={a.borough} />
                  {a.borough}
                  <span className="sm:hidden">· {formatCount(a.menuCounts.menus)} menus</span>
                </span>
              </th>
              <td className="num t-num-m">{formatPrice(a.index_median, { cents: "always" })}</td>
              <td className="hidden md:table-cell">
                <div className="flex items-center gap-3">
                  <span className="t-num-s muted w-28 whitespace-nowrap">
                    {formatSpan(formatPrice(a.index_min, { cents: "always" }), formatPrice(a.index_max, { cents: "always" }))}
                  </span>
                  <span className="relative block h-3 min-w-24 flex-1" aria-hidden="true">
                    <span
                      className="absolute top-1/2 h-0.5 -translate-y-1/2"
                      style={{ left: pct(a.index_min ?? lo), width: `calc(${pct(a.index_max ?? lo)} - ${pct(a.index_min ?? lo)})`, background: "var(--axis)" }}
                    />
                    <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: pct(a.index_median ?? lo) }} />
                  </span>
                </div>
              </td>
              <td className="num hidden sm:table-cell">
                {formatCount(a.menuCounts.menus)}
                <span className="t-ui-s muted block whitespace-nowrap">{menuBreakdownShort(a.menuCounts)}</span>
              </td>
              <td className="num t-num-s muted hidden lg:table-cell">{formatDelta(a.index_median, cityMedian)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
