import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Net } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { RankingLinks } from "@/components/Rankings";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { WorthBoardHead, WorthRowView } from "@/components/worth/WorthRows";
import { getPricedRestaurants } from "@/lib/data";
import { formatCount, formatDate } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { BEST_VALUE_MIN_GAP, BEST_VALUE_NAME, BEST_VALUE_PATH, bestValueLede } from "@/lib/peoples-price";
import { getBestValue } from "@/lib/peoples-price-data";
import { rankingSpecs } from "@/lib/rankings";
import { bestValueSeo } from "@/lib/seo";
import { PLACEHOLDER_PARAM, SITE_NAME } from "@/lib/site";

// "Best value burgers in NYC" (user decision 2026-09-25; DESIGN.md "The best value burgers page"): the menus
// whose People's Price is 10% or more above the menu price, from the daily snapshot (lib/peoples-price). The
// page exists only once 10 menus have a verdict (3+ answers). Until then the route builds nothing at
// /best-value-burgers: an optional catch-all, because a static export can't have a route that builds no page,
// builds only its placeholder (site.ts PLACEHOLDER_PARAM: /best-value-burgers/_none, the 404, linked from
// nowhere and never in the sitemap), and nothing links here.
export const dynamicParams = false;

export function generateStaticParams() {
  return getBestValue() ? [{ all: [] }] : [{ all: [PLACEHOLDER_PARAM] }];
}

const CRUMBS = [{ href: "/", label: SITE_NAME }, { href: "/peoples-price", label: "The People's Price" }, { label: "Best value burgers" }];

export async function generateMetadata({ params }: PageProps<"/best-value-burgers/[[...all]]">): Promise<Metadata> {
  const { all } = await params;
  const bv = getBestValue();
  if (all?.length || !bv) return {};
  const seo = bestValueSeo({
    name: BEST_VALUE_NAME,
    minGap: BEST_VALUE_MIN_GAP,
    rows: bv.rows.map((r) => ({ name: r.name, people: r.people, price: r.price })),
    asOf: bv.asOf,
    asOfDay: formatDate(bv.asOf),
  });
  return pageMetadata({ ...seo, path: BEST_VALUE_PATH });
}

/**
 * Ranked like the People's Price board's bargains (the widest gap first; ties share a rank, then more answers,
 * then name), one row per distinct menu (a chain once), each linking to its restaurant's slider. Static: the
 * numbers are the snapshot's, dated in the lede. ItemList JSON-LD restates the rows; never Review or Rating.
 */
export default async function BestValuePage({ params }: PageProps<"/best-value-burgers/[[...all]]">) {
  const { all } = await params;
  const bv = getBestValue();
  if (all?.length || !bv) notFound();
  const { rows } = bv;
  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, CRUMBS, BEST_VALUE_PATH),
          rows.length
            ? itemListNode(SITE_URL, {
                name: BEST_VALUE_NAME,
                order: "descending",
                entries: rows.map((r) => ({ name: r.name, path: `/restaurants/${r.id}` })),
              })
            : null,
        ]}
      />
      <PageHeader crumbs={CRUMBS} ticket="Good catch" ticketIcon={Net} title={`${BEST_VALUE_NAME}.`} lede={bestValueLede(bv)} />
      <div className="wrap">
        <section className="mt-2" aria-label={BEST_VALUE_NAME}>
          <p className="t-ui-m mb-4 text-balance">{`Burgers whose People's Price is ${BEST_VALUE_MIN_GAP}% or more above the menu price, the widest gap first.`}</p>
          {rows.length ? (
            <>
              <div className="worth-board-shell">
                <WorthBoardHead ranked />
                <ol className="worth-board" aria-label={BEST_VALUE_NAME}>
                  {rows.map((r) => (
                    <WorthRowView key={r.key} row={r} ranked />
                  ))}
                </ol>
              </div>
              {rows.length > 1 ? <p className="t-ui-s muted mt-3">All {formatCount(rows.length)} menus on this list.</p> : null}
            </>
          ) : (
            <EmptyState height={200}>No burgers on this list yet. Nothing in the net.</EmptyState>
          )}
          <p className="mt-6">
            <Link href="/peoples-price" className="btn btn-secondary">
              See the People&apos;s Price
              <ArrowRight strokeWidth={2} aria-hidden="true" />
            </Link>
          </p>
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={BEST_VALUE_PATH} available={rankingSpecs(getPricedRestaurants())} bestValue />
          </div>
        </section>
      </div>
    </>
  );
}
