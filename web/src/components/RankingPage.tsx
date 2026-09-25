// One ranking page (DESIGN.md "Ranking page"): the shallows header with breadcrumbs, a ticket, the H1 in
// plain words and a one-line answer; the ranked table (distinct menus, a chain once) with how many
// there are; a link to the same list on /burgers; then every other ranking. ItemList JSON-LD restates
// the table row for row. Server-only: it reads the dataset.
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { endSentence, segmentsText, underSentence } from "@/lib/answers";
import { BOROUGHS_HREF, SITE_NAME } from "@/lib/site";
import { getGeneratedAt, getPricedRestaurants, getStats } from "@/lib/data";
import { formatCount, formatMonthYear, formatPrice } from "@/lib/format";
import { breadcrumbNode, itemListNode, type Crumb } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { explorerHref, rankingName, rankingPath, rankingPlace, rankingShortName, rankingSpecs, rankMenus, topTied, type RankingSpec } from "@/lib/rankings";
import { rankingSeo } from "@/lib/seo";
import { Anchor, Net, OrderBell } from "./icons/nautical";
import { JsonLd } from "./JsonLd";
import { RankingLinks, RankingTable } from "./Rankings";
import { EmptyState, PageHeader, SectionHeading } from "./ui";

/** The kicker ticket over each kind of list (a callout kicker from the home cards, or the section's). */
const TICKET = {
  cheapest: { text: "Cheapest on the counter", icon: OrderBell },
  priciest: { text: "Top shelf", icon: Anchor },
  under: { text: "Catch of the day", icon: Net },
} as const;

function crumbsFor(spec: RankingSpec): Crumb[] {
  return spec.borough
    ? [{ href: BOROUGHS_HREF, label: "Boroughs" }, { href: `/boroughs/${spec.borough.slug}`, label: spec.borough.name }, { label: rankingShortName(spec) }]
    : [{ href: "/", label: SITE_NAME }, { label: rankingShortName(spec) }];
}

export function rankingMetadata(spec: RankingSpec): Metadata {
  const { rows, total } = rankMenus(getPricedRestaurants(), spec);
  const seo = rankingSeo({
    kind: spec.kind,
    name: rankingName(spec),
    place: rankingPlace(spec),
    under: spec.under,
    rows: rows.map((m) => ({ restaurant: m.restaurant.name, burger: m.restaurant.burger.name, price: m.indexPrice })),
    total,
    generatedAt: getGeneratedAt(),
  });
  return pageMetadata({ ...seo, path: rankingPath(spec) });
}

export function RankingPage({ spec }: { spec: RankingSpec }) {
  const restaurants = getPricedRestaurants();
  const median = getStats().index_median;
  const { rows, total } = rankMenus(restaurants, spec);
  const month = formatMonthYear(getGeneratedAt());
  const name = rankingName(spec);
  const place = rankingPlace(spec);
  const path = rankingPath(spec);
  const crumbs = crumbsFor(spec);
  const answer = segmentsText(spec.kind === "under" ? underSentence(spec.under as number, place, rows, month) : endSentence(spec.kind, place, topTied(rows), month));
  const count =
    spec.kind === "under"
      ? `All ${formatCount(rows.length)} burgers under ${formatPrice(spec.under)} in ${place}, cheapest first.`
      : `The ${formatCount(rows.length)} ${spec.kind === "cheapest" ? "cheapest" : "most expensive"} of ${formatCount(total)} burgers in ${place}.`;
  const ticket = TICKET[spec.kind];

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
      <PageHeader crumbs={crumbs} ticket={ticket.text} ticketIcon={ticket.icon} title={`${name}.`} lede={answer} />
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
          <p className="mt-6">
            <Link href={explorerHref(spec)} className="btn btn-secondary">
              {spec.kind === "under" ? `Every burger under ${formatPrice(spec.under)}` : `Every burger in ${place}`}
              <ArrowRight strokeWidth={2} aria-hidden="true" />
            </Link>
          </p>
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={path} available={rankingSpecs(restaurants)} />
          </div>
        </section>
      </div>
    </>
  );
}
