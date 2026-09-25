// Plain lists of neighborhoods ("Other neighborhoods", "Elsewhere in …") with a per-row median and
// how many distinct menus it rests on. A neighborhood with nothing priced has no page: its row is an
// unlinked name.
import Link from "next/link";
import { formatDelta, formatPrice, formatSpan, pluralize } from "@/lib/format";
import type { AreaWithMenus } from "@/lib/menus";
import { BoroughDot } from "./ui";

/** "$7.75 · 4 menus", "not priced". */
export function areaMenuMeta(a: AreaWithMenus): string {
  const c = a.menuCounts;
  if (!c.menus || a.index_median === null) return "not priced";
  return `${formatPrice(a.index_median, { cents: "always" })} · ${pluralize(c.menus, "menu")}`;
}

export function AreaListItem({ area }: { area: AreaWithMenus }) {
  const hasPage = area.restaurants_priced > 0;
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-1.5">
      {hasPage ? (
        <Link href={`/neighborhoods/${area.slug}`} className="ui-link t-ui-m break-anywhere min-w-0">
          {area.name}
        </Link>
      ) : (
        <span className="t-ui-m muted break-anywhere min-w-0">{area.name}</span>
      )}
      <span className="t-num-s muted text-right whitespace-nowrap">{areaMenuMeta(area)}</span>
    </li>
  );
}

/**
 * The ranking when exactly one neighborhood qualifies (a borough page): one row of its numbers instead
 * of a one-row dot-and-range chart or a sortable table whose only rank is 1.
 */
export function SoleRanked({ area, cityMedian }: { area: AreaWithMenus; cityMedian: number | null }) {
  const c = area.menuCounts;
  const range =
    area.index_min !== null && area.index_max !== null ? formatSpan(formatPrice(area.index_min, { cents: "always" }), formatPrice(area.index_max, { cents: "always" })) : null;
  const detail = [range ? `Range ${range}` : null, pluralize(c.menus, "menu"), formatDelta(area.index_median, cityMedian, { suffix: "vs NYC", atLabel: "at the NYC median" })].filter(Boolean);
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
