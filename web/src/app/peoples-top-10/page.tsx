import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { RopeLadder } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { PeoplesTopList, RisingList } from "@/components/PeoplesTop";
import { RankingLinks } from "@/components/Rankings";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { getPricedRestaurants, getStats } from "@/lib/data";
import { pluralize } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { asOfText, boardCountLine, ladderStartText, PEOPLES_TOP_ONE_LINER, PEOPLES_TOP_TICKET, peoplesTopLede, seatsHeading } from "@/lib/peoples-top";
import { getPeoplesTop } from "@/lib/peoples-top-data";
import { rankingSpecs } from "@/lib/rankings";
import { peoplesTopSeo } from "@/lib/seo";
import { shareImage } from "@/lib/share-cards";
import { PEOPLES_TOP_NAME, PEOPLES_TOP_PATH, RANKER_HREF, SITE_NAME } from "@/lib/site";

const top = getPeoplesTop();

export const metadata = pageMetadata({
  ...peoplesTopSeo({ leaders: top.seats.map((e) => e.menu.restaurant.name), lists: top.totalLists, asOf: top.asOf }),
  path: PEOPLES_TOP_PATH,
  image: shareImage(PEOPLES_TOP_PATH),
});

/**
 * The People's Top 10 (user decisions 2026-09-25/26; DESIGN.md "The People's Top 10 page"): the daily board of the
 * burgers visitors rank highest, from their own lists (the home ranker). The 10 seats, the rest of the ranking and the
 * Rising tier, "Early results" until 500 lists, "≈" where two rows are too close to call, and the one-liner as the
 * page's only word on method. An ItemList restates the ranked rows (never Review, Rating or AggregateRating).
 */
export default function PeoplesTopPage() {
  const median = getStats().index_median;
  const crumbs = [{ href: "/", label: SITE_NAME }, { label: "People's Top 10" }];
  const ranked = [...top.seats, ...top.rest];
  const first = top.seats[0];
  const asOf = asOfText(top.asOf);
  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, PEOPLES_TOP_PATH),
          ranked.length
            ? itemListNode(SITE_URL, {
                name: PEOPLES_TOP_NAME,
                entries: ranked.map((e) => ({ name: e.menu.restaurant.name, path: `/restaurants/${e.menu.restaurant.id}` })),
              })
            : null,
        ]}
      />
      <PageHeader
        crumbs={crumbs}
        ticket={PEOPLES_TOP_TICKET}
        ticketIcon={RopeLadder}
        title={`${PEOPLES_TOP_NAME}.`}
        lede={peoplesTopLede(first ? { name: first.menu.restaurant.name, lists: first.lists, firsts: first.firsts } : null, top.asOf)}
      />
      <div className="wrap">
        {top.early || asOf ? (
          <p className="ptop-meta">
            {top.early ? <span className="badge ptop-early">Early results</span> : null}
            {asOf ? <span className="t-ui-s muted">{asOf}</span> : null}
          </p>
        ) : null}
        {/* The page's one word on method (user decision 2026-09-26). */}
        <p className="t-ui-m prose-width mt-3 text-balance">{PEOPLES_TOP_ONE_LINER}</p>

        <section className="mt-8" aria-labelledby="top-10">
          <h2 id="top-10" className="t-display-m">
            {top.seats.length ? seatsHeading(top.seats.length) : "The top 10."}
          </h2>
          <div className="mt-4">
            {top.seats.length ? (
              <>
                <PeoplesTopList entries={top.seats} median={median} label={PEOPLES_TOP_NAME} />
                <p className="t-ui-s muted mt-3">{boardCountLine(top)}</p>
                {top.seats.some((e) => e.closeToAbove) ? <CloseLegend /> : null}
              </>
            ) : (
              <EmptyState
                height={220}
                action={
                  <Link href={RANKER_HREF} className="btn btn-primary">
                    Rank your burgers
                  </Link>
                }
              >
                No burger is ranked yet. {ladderStartText(top.gate, top.totalLists)}
              </EmptyState>
            )}
          </div>
        </section>

        {top.rest.length ? (
          <section className="section" aria-labelledby="the-rest">
            <SectionHeading id="the-rest" title={`${pluralize(top.rest.length, "more burger")} on the ladder.`} />
            <div className="mt-6">
              <PeoplesTopList entries={top.rest} median={median} label="The rest of the ranking" />
              {top.rest.some((e) => e.closeToAbove) ? <CloseLegend /> : null}
            </div>
          </section>
        ) : null}

        {top.rising.length ? (
          <section className="section" aria-labelledby="rising">
            <SectionHeading id="rising" kicker="Climbing the ladder" icon={RopeLadder} title={`Rising: ${pluralize(top.rising.length, "burger")} not ranked yet.`} />
            <div className="mt-6">
              <RisingList entries={top.rising} median={median} />
            </div>
          </section>
        ) : null}

        <section className="section" aria-labelledby="your-list">
          <SectionHeading id="your-list" title="Add your list.">
            Rank 3 to 25 burgers, your favorite first. You can change your list any time.
          </SectionHeading>
          <p className="mt-6">
            <Link href={RANKER_HREF} className="btn btn-primary btn-lg">
              <RopeLadder aria-hidden="true" />
              Rank your burgers
              <ArrowRight strokeWidth={2} aria-hidden="true" />
            </Link>
          </p>
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={PEOPLES_TOP_PATH} available={rankingSpecs(getPricedRestaurants())} />
          </div>
        </section>
      </div>
    </>
  );
}

/** The "≈" legend under a list that carries the mark. */
function CloseLegend() {
  return (
    <p className="t-ui-s muted mt-1">
      <span aria-hidden="true">≈ </span>Too close to call with the burger above.
    </p>
  );
}
