// Plain link lists of neighborhoods ("Too few to rank", "Elsewhere in …") with a per-row median and
// how many distinct menus it rests on. A chain-only row carries "Chain prices only" under its median,
// the same words as the badge, the charts and the tables.
import Link from "next/link";
import { formatPrice, pluralize } from "@/lib/format";
import { isChainOnly, type AreaWithMenus } from "@/lib/menus";

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
