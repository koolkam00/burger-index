// One ranking page (DESIGN.md "Ranking page"): the shallows header with breadcrumbs, a ticket, the H1 in
// plain words and a one-line answer; the ranked table (distinct menus, a chain once) with how many
// there are; a link to the same list on /burgers (none for a style list: the explorer has no style
// filter); then every other ranking. ItemList JSON-LD restates the table row for row. Cheapest, under-$N
// and style lists rank burger spots by their priciest burger and say so (lib/rankings.ts). Server-only:
// it reads the dataset.
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { endSentence, segmentsText, styleSentence, underSentence } from "@/lib/answers";
import { BOROUGHS_HREF, SITE_NAME } from "@/lib/site";
import { getGeneratedAt, getPricedRestaurants, getStats } from "@/lib/data";
import { formatMonthYear } from "@/lib/format";
import { breadcrumbNode, itemListNode, type Crumb } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { hasBestValuePage } from "@/lib/peoples-price-data";
import {
  explorerHref,
  RANKING_TICKETS,
  rankingCountLine,
  rankingIn,
  rankingName,
  rankingPath,
  rankingPlace,
  rankingShortName,
  rankingSpecs,
  rankMenus,
  topTied,
  type RankingSpec,
} from "@/lib/rankings";
import { rankingSeo } from "@/lib/seo";
import { shareImage } from "@/lib/share-cards";
import { Anchor, Net, OrderBell, Spatula } from "./icons/nautical";
import { JsonLd } from "./JsonLd";
import { RankingLinks, RankingTable } from "./Rankings";
import { EmptyState, PageHeader, SectionHeading } from "./ui";

/** The kicker ticket's icon over each kind of list (its text: rankings.ts RANKING_TICKETS). */
const TICKET_ICON = { cheapest: OrderBell, priciest: Anchor, under: Net, style: Spatula } as const;

function crumbsFor(spec: RankingSpec): Crumb[] {
  const short = { label: rankingShortName(spec) };
  if (spec.kind === "style") return [{ href: "/", label: SITE_NAME }, { href: "/burgers", label: "Every burger" }, short];
  if (spec.neighborhood) {
    const n = spec.neighborhood;
    return [{ href: "/neighborhoods", label: "Neighborhoods" }, { href: `/boroughs/${n.borough.slug}`, label: n.borough.name }, { href: `/neighborhoods/${n.slug}`, label: n.name }, short];
  }
  return spec.borough
    ? [{ href: BOROUGHS_HREF, label: "Boroughs" }, { href: `/boroughs/${spec.borough.slug}`, label: spec.borough.name }, short]
    : [{ href: "/", label: SITE_NAME }, short];
}

export function rankingMetadata(spec: RankingSpec): Metadata {
  const { rows, total, spots } = rankMenus(getPricedRestaurants(), spec);
  const seo = rankingSeo({
    kind: spec.kind,
    name: rankingName(spec),
    place: rankingPlace(spec),
    inPlace: rankingIn(spec),
    shortName: rankingShortName(spec),
    under: spec.under,
    aBurger: spec.style?.aBurger,
    rows: rows.map((m) => ({ restaurant: m.restaurant.name, burger: m.restaurant.burger.name, price: m.indexPrice })),
    total,
    spots,
    generatedAt: getGeneratedAt(),
  });
  const path = rankingPath(spec);
  return pageMetadata({ ...seo, path, image: shareImage(path) });
}

export function RankingPage({ spec }: { spec: RankingSpec }) {
  const restaurants = getPricedRestaurants();
  const median = getStats().index_median;
  const { rows, total } = rankMenus(restaurants, spec);
  const month = formatMonthYear(getGeneratedAt());
  const name = rankingName(spec);
  const inPlace = rankingIn(spec);
  const path = rankingPath(spec);
  const crumbs = crumbsFor(spec);
  const answer = segmentsText(
    spec.kind === "under"
      ? underSentence(spec.under as number, inPlace, rows, month)
      : spec.kind === "style"
        ? styleSentence(spec.style!.aBurger, inPlace, rows, month)
        : endSentence(spec.kind, inPlace, topTied(rows), month),
  );
  // The rows are distinct menus (a chain once), so they are counted as "menus"; "burger spots" always
  // counts locations (the lede's "At 96 burger spots", as /burgers counts them).
  const count = rankingCountLine(spec, { rows, total });
  const explorer = explorerHref(spec);

  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, path),
          rows.length
            ? itemListNode(SITE_URL, {
                name,
                order: spec.kind === "priciest" ? "descending" : "ascending",
                entries: rows.map((m) => ({ name: m.restaurant.name, path: `/restaurants/${m.restaurant.id}` })),
              })
            : null,
        ]}
      />
      <PageHeader crumbs={crumbs} ticket={RANKING_TICKETS[spec.kind]} ticketIcon={TICKET_ICON[spec.kind]} title={`${name}.`} lede={answer} />
      <div className="wrap">
        <section className="mt-2" aria-label={name}>
          {rows.length ? (
            <>
              <RankingTable rows={rows} spec={spec} median={median} caption={name} />
              {rows.length > 1 ? <p className="t-ui-s muted mt-3">{count}</p> : null}
            </>
          ) : (
            <EmptyState height={200}>No burgers on this list yet. Nothing in the net.</EmptyState>
          )}
          {explorer ? (
            <p className="mt-6">
              <Link href={explorer} className="btn btn-secondary">
                {spec.kind === "under" ? "Every location on this list" : `Every burger ${inPlace}`}
                <ArrowRight strokeWidth={2} aria-hidden="true" />
              </Link>
            </p>
          ) : null}
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={path} available={rankingSpecs(restaurants)} neighborhood={spec.neighborhood} bestValue={hasBestValuePage()} />
          </div>
        </section>
      </div>
    </>
  );
}
