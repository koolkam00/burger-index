// The ranking pages' table and the grouped links between ranking pages (DESIGN.md "Ranking page").
// Server-safe and presentational: the pages pass the rows (lib/rankings.ts rankMenus).
import Link from "next/link";
import { BOROUGH_META } from "@/lib/boroughs";
import { formatDelta, pluralize } from "@/lib/format";
import { boroughRankings, chainExplorerHref, CITY_RANKINGS, rankingName, rankingPath, type RankedMenu, type RankingSpec } from "@/lib/rankings";
import { BoroughDot, PriceChip, SourceBadge } from "./ui";

/**
 * One row per distinct menu, in rank order: rank, the restaurant (a chain once, with how many of its
 * locations the list covers, linked to /burgers searched for it), its burger, the price chip (colored
 * against the NYC median, like every chip) and vs NYC.
 */
export function RankingTable({ rows, spec, median, caption }: { rows: readonly RankedMenu[]; spec: RankingSpec; median: number | null; caption: string }) {
  return (
    <div className="table-shell">
      <table className="data-table ranking-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num rank-col">
              Rank
            </th>
            <th scope="col">Restaurant</th>
            <th scope="col" className="hidden sm:table-cell">
              Burger
            </th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num hidden sm:table-cell">
              vs NYC
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const r = m.restaurant;
            const chainRow = m.chain !== null && m.locations > 1;
            return (
              <tr key={m.key}>
                <td className="num rank-col t-num-m">{m.rank}</td>
                <th scope="row" className="min-w-0">
                  <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                    {r.name}
                  </Link>
                  {/* Below sm the burger shares this cell, under its restaurant. */}
                  <div className="mt-0.5 break-anywhere sm:hidden">{r.burger.name}</div>
                  <div className="t-ui-s muted break-anywhere">
                    {chainRow ? (
                      <Link href={chainExplorerHref(m, spec)} className="ui-link text-ink-muted underline hover:text-ink">
                        {pluralize(m.locations, spec.borough ? `${spec.borough.name} location` : "location")}
                      </Link>
                    ) : r.neighborhood ? (
                      `${r.neighborhood} · ${r.borough}`
                    ) : (
                      r.borough
                    )}
                  </div>
                  <div className="mt-1">
                    <SourceBadge source={r.price_source} />
                  </div>
                </th>
                <td className="hidden min-w-0 break-anywhere sm:table-cell">{r.burger.name}</td>
                <td className="num">
                  <PriceChip price={m.indexPrice} median={median} delta={false} />
                </td>
                <td className="num t-num-s muted hidden whitespace-nowrap sm:table-cell">{formatDelta(m.indexPrice, median)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every ranking page, grouped: New York City first, then each borough with its flag dot, as plain
 * list rows. `current` (this page's path) is named, not linked. `available` leaves out the lists of a
 * borough with nothing priced.
 */
export function RankingLinks({ current, available }: { current?: string; available: readonly RankingSpec[] }) {
  const paths = new Set(available.map(rankingPath));
  const groups = [
    { key: "nyc", title: "New York City", borough: null, specs: CITY_RANKINGS },
    ...BOROUGH_META.map((b) => ({ key: b.slug, title: b.name, borough: b.name, specs: boroughRankings(b) })),
  ]
    .map((g) => ({ ...g, specs: g.specs.filter((s) => paths.has(rankingPath(s))) }))
    .filter((g) => g.specs.length);
  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <div key={g.key} className="min-w-0">
          <h3 className="t-label muted flex items-center gap-2">
            {g.borough ? <BoroughDot borough={g.borough} /> : null}
            {g.title}
          </h3>
          <ul className="mt-2">
            {g.specs.map((s) => {
              const path = rankingPath(s);
              return (
                <li key={path} className="flex min-h-11 items-center border-b border-line py-1.5">
                  {path === current ? (
                    <span className="t-ui-m muted break-anywhere" aria-current="page">
                      {rankingName(s)}
                    </span>
                  ) : (
                    <Link href={path} className="ui-link t-ui-m break-anywhere">
                      {rankingName(s)}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
