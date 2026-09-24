// Plain link lists of neighborhoods ("Too few to rank", "Elsewhere in …") with a per-row median and
// how many distinct menus it rests on. A chain-only row carries "Chain prices only" under its median,
// the same words as the badge, the charts and the tables.
import Link from "next/link";
import { formatCount, formatDelta, formatPrice, formatSpan, pluralize } from "@/lib/format";
import { isChainOnly, shareOfCity, type AreaWithMenus, type MenuCounts } from "@/lib/menus";
import { BoroughDot } from "./ui";

/** "$7.75 · 4 menus", "not priced". */
export function areaMenuMeta(a: AreaWithMenus): string {
  const c = a.menuCounts;
  if (!c.menus || a.index_median === null) return "not priced";
  return `${formatPrice(a.index_median, { cents: "always" })} · ${pluralize(c.menus, "menu")}`;
}

export function AreaListItem({ area }: { area: AreaWithMenus }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-1.5">
      <Link href={`/neighborhoods/${area.slug}`} className="ui-link t-ui-m break-anywhere min-w-0">
        {area.name}
      </Link>
      <span className="text-right">
        <span className="t-num-s muted block whitespace-nowrap">{areaMenuMeta(area)}</span>
        {isChainOnly(area.menuCounts) ? <span className="t-ui-s muted block whitespace-nowrap">Chain prices only</span> : null}
      </span>
    </li>
  );
}

/** The one-line key under a list that has chain-only rows. */
export function ChainMenuNote({ areas }: { areas: readonly AreaWithMenus[] }) {
  const priced = areas.filter((a) => a.menuCounts.menus > 0);
  const n = priced.filter((a) => isChainOnly(a.menuCounts)).length;
  if (!n) return null;
  return (
    <p className="t-ui-s muted mt-3">
      {n === priced.length
        ? `Chain prices only so far: every priced neighborhood in this list is priced from chain menus. No independent restaurant in ${n === 1 ? "it" : "them"} is priced yet.`
        : "Rows marked “Chain prices only” have no independent restaurant priced yet."}
    </p>
  );
}

/**
 * The ranking when exactly one neighborhood qualifies: one row of its numbers instead of a one-row
 * dot-and-range chart or a sortable table whose only rank is 1. `cityMenus`: the citywide menu counts,
 * so a neighborhood holding most of the menus behind the NYC median says so beside its delta, and one
 * holding all of them shows no delta (it would compare the median with itself).
 */
export function SoleRanked({ area, cityMedian, cityMenus }: { area: AreaWithMenus; cityMedian: number | null; cityMenus: MenuCounts }) {
  const c = area.menuCounts;
  const share = isChainOnly(c) ? null : shareOfCity(c, cityMenus);
  const range =
    area.index_min !== null && area.index_max !== null ? formatSpan(formatPrice(area.index_min, { cents: "always" }), formatPrice(area.index_max, { cents: "always" })) : null;
  const detail = [
    range ? `Range ${range}` : null,
    share === "most" ? `${formatCount(c.menus)} of the ${formatCount(cityMenus.menus)} menus in the NYC index` : pluralize(c.menus, "menu"),
    isChainOnly(c)
      ? "Chain prices only"
      : share === "all"
        ? "Every menu in the NYC index"
        : formatDelta(area.index_median, cityMedian, { suffix: "vs NYC", atLabel: "at the NYC median" }),
  ].filter(Boolean);
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-y border-line py-3">
      <span className="flex min-w-0 items-center gap-2">
        <BoroughDot borough={area.borough} />
        <Link href={`/neighborhoods/${area.slug}`} className="ui-link t-ui-l break-anywhere min-w-0 font-semibold">
          {area.name}
        </Link>
        <span className="t-ui-s muted">{area.borough}</span>
      </span>
      <span className="min-w-0 sm:text-right">
        <span className="t-num-m block">Median {formatPrice(area.index_median, { cents: "always" })}</span>
        <span className="t-ui-s muted block">{detail.join(" · ")}</span>
      </span>
    </div>
  );
}
