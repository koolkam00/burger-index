// The ranking pages' table and the grouped links between ranking pages (DESIGN.md "Ranking page").
// Server-safe and presentational: the pages pass the rows (lib/rankings.ts rankMenus).
import Link from "next/link";
import { BEST_BURGERS_NAME, BEST_BURGERS_PATH } from "@/lib/best-burgers";
import { BOROUGH_META } from "@/lib/boroughs";
import { formatDelta, pluralize } from "@/lib/format";
import {
  boroughRankings,
  chainExplorerHref,
  CITY_RANKINGS,
  neighborhoodRankings,
  rankingName,
  rankingPath,
  rankingShortName,
  type RankedMenu,
  type RankingNeighborhood,
  type RankingSpec,
} from "@/lib/rankings";
import type { Borough } from "@/lib/schema";
import { PEOPLES_TOP_NAME, PEOPLES_TOP_PATH } from "@/lib/site";
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
                        {pluralize(m.locations, spec.borough && !spec.neighborhood ? `${spec.borough.name} location` : "location")}
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

type LinkGroup = { key: string; title: string; borough: Borough | null; links: Array<{ href: string; label: string }> };

const specLink = (s: RankingSpec) => ({ href: rankingPath(s), label: rankingName(s) });

/**
 * Every ranking page, grouped: a neighborhood's own two lists first on its ranking pages, then New York
 * City (with the most-recommended burgers and the People's Top 10), the burger styles and each borough with its flag dot, as plain
 * list rows. `current` (this page's path) is named, not linked. `available` (rankings.ts rankingSpecs)
 * leaves out the lists of a borough with nothing priced and the styles without a list. The other
 * neighborhoods' lists are linked from their neighborhood pages.
 */
export function RankingLinks({
  current,
  available,
  neighborhood = null,
}: {
  current?: string;
  available: readonly RankingSpec[];
  neighborhood?: RankingNeighborhood | null;
}) {
  const paths = new Set(available.map(rankingPath));
  const has = (s: RankingSpec) => paths.has(rankingPath(s));
  const groups: LinkGroup[] = [
    ...(neighborhood
      ? [{ key: `n-${neighborhood.slug}`, title: neighborhood.name, borough: neighborhood.borough.name, links: neighborhoodRankings(neighborhood).filter(has).map(specLink) }]
      : []),
    {
      key: "nyc",
      title: "New York City",
      borough: null,
      links: [
        ...CITY_RANKINGS.filter(has).map(specLink),
        { href: BEST_BURGERS_PATH, label: BEST_BURGERS_NAME },
        { href: PEOPLES_TOP_PATH, label: PEOPLES_TOP_NAME },
      ],
    },
    {
      key: "styles",
      title: "Burger styles",
      borough: null,
      links: available.filter((s) => s.kind === "style").map((s) => ({ href: rankingPath(s), label: `${rankingShortName(s)} in NYC` })),
    },
    ...BOROUGH_META.map((b) => ({ key: b.slug, title: b.name, borough: b.name, links: boroughRankings(b).filter(has).map(specLink) })),
  ].filter((g) => g.links.length);
  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <div key={g.key} className="min-w-0">
          <h3 className="t-label muted flex items-center gap-2">
            {g.borough ? <BoroughDot borough={g.borough} /> : null}
            {g.title}
          </h3>
          <ul className="mt-2">
            {g.links.map((l) => (
              <li key={l.href} className="flex min-h-11 items-center border-b border-line py-1.5">
                {l.href === current ? (
                  <span className="t-ui-m muted break-anywhere text-balance" aria-current="page">
                    {l.label}
                  </span>
                ) : (
                  <Link href={l.href} className="ui-link t-ui-m break-anywhere text-balance">
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
