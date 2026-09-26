// "Burgers near <landmark>" (user decision 2026-09-26; DESIGN.md "Landmark pages"): the landmark page (the shallows
// header with a one-line answer, the spots nearest first, the map link, the other landmarks) and the landmark links
// shared with the hub. ItemList JSON-LD restates the table row for row. Server-only: it reads the dataset.
import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BOROUGH_META } from "@/lib/boroughs";
import { getGeneratedAt, getStats } from "@/lib/data";
import { formatMonthYear } from "@/lib/format";
import { breadcrumbNode, itemListNode, type Crumb } from "@/lib/jsonld";
import { landmarkPages } from "@/lib/landmark-routes";
import {
  LANDMARKS_CRUMB,
  LANDMARKS_PATH,
  LANDMARKS_TICKET,
  landmarkCountLine,
  landmarkMapHref,
  landmarkPath,
  landmarkSentence,
  landmarkSummary,
  landmarkTitle,
  priceEnds,
  RADIUS_WORDS,
  spotDistance,
  WALK_WORDS,
  type LandmarkPage,
  type LandmarkSpot,
} from "@/lib/landmarks";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { landmarkSeo } from "@/lib/seo";
import { shareImage } from "@/lib/share-cards";
import { SITE_NAME } from "@/lib/site";
import { CompassRose } from "./icons/nautical";
import { JsonLd } from "./JsonLd";
import { repeatedNames } from "./RestaurantBits";
import { BoroughDot, PageHeader, PriceChip, SectionHeading, SourceBadge } from "./ui";

export const LANDMARK_TICKET_ICON = CompassRose;

function crumbsFor(page: LandmarkPage): Crumb[] {
  return [{ href: "/", label: SITE_NAME }, { href: LANDMARKS_PATH, label: LANDMARKS_CRUMB }, { label: page.landmark.name }];
}

export function landmarkMetadata(page: LandmarkPage): Metadata {
  const ends = priceEnds(page.spots);
  const named = (s: LandmarkSpot) => ({ name: s.restaurant.name, price: s.restaurant.index_price });
  const seo = landmarkSeo({
    near: page.landmark.near,
    short: page.landmark.short,
    spots: page.spots.length,
    radius: RADIUS_WORDS,
    walk: WALK_WORDS,
    low: ends ? named(ends.low) : null,
    high: ends ? named(ends.high) : null,
    generatedAt: getGeneratedAt(),
  });
  const path = landmarkPath(page.landmark);
  return pageMetadata({ ...seo, path, image: shareImage(path) });
}

/**
 * The spots, nearest first, one row per location: how far (as the crow flies), the restaurant (its burger under it
 * below `sm`, then "neighborhood · borough", or its street address when a chain has two rows here, then the source
 * badge), the burger (from `sm`) and the price chip (colored against the NYC median, like every chip).
 */
export function LandmarkTable({ spots, median, caption }: { spots: readonly LandmarkSpot[]; median: number | null; caption: string }) {
  const repeated = repeatedNames(spots.map((s) => s.restaurant));
  return (
    <div className="table-shell">
      <table className="data-table landmark-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num dist-col">
              Away
            </th>
            <th scope="col">Restaurant</th>
            <th scope="col" className="hidden sm:table-cell">
              Burger
            </th>
            <th scope="col" className="num">
              Price
            </th>
          </tr>
        </thead>
        <tbody>
          {spots.map((s) => {
            const r = s.restaurant;
            const where = repeated.has(r.name) && r.address ? [r.address, r.neighborhood ?? r.borough] : [r.neighborhood, r.borough];
            return (
              <tr key={r.id}>
                <td className="num dist-col t-num-m">{spotDistance(s)}</td>
                <th scope="row" className="min-w-0">
                  <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                    {r.name}
                  </Link>
                  {/* Below sm the burger shares this cell, under its restaurant. */}
                  <div className="mt-0.5 break-anywhere sm:hidden">{r.burger.name}</div>
                  <div className="t-ui-s muted break-anywhere">{where.filter(Boolean).join(" · ")}</div>
                  <div className="mt-1">
                    <SourceBadge source={r.price_source} />
                  </div>
                </th>
                <td className="hidden min-w-0 break-anywhere sm:table-cell">{r.burger.name}</td>
                <td className="num">
                  <PriceChip price={r.index_price} median={median} delta={false} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every landmark with a page, grouped by borough (its flag dot and name as the group heading), each a row with its
 * spot count and the range of their priciest burgers. `current` (this page's landmark) is named, not linked.
 */
export function LandmarkLinks({ pages, current, headingLevel = 3 }: { pages: readonly LandmarkPage[]; current?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const groups = BOROUGH_META.map((b) => ({ borough: b.name, pages: pages.filter((p) => p.landmark.borough === b.name) })).filter((g) => g.pages.length);
  return (
    <div className="grid gap-8">
      {groups.map((g) => (
        <div key={g.borough} className="min-w-0">
          <Heading className="t-label muted flex items-center gap-2">
            <BoroughDot borough={g.borough} />
            {g.borough}
          </Heading>
          <ul className="landmark-links mt-2 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {g.pages.map((p) => {
              const path = landmarkPath(p.landmark);
              return (
                <li key={p.landmark.slug} className="flex min-h-14 items-center border-b-[1.5px] border-line py-2">
                  <span className="min-w-0">
                    {path === current ? (
                      <span className="t-ui-m muted break-anywhere block font-semibold" aria-current="page">
                        {p.landmark.name}
                      </span>
                    ) : (
                      <Link href={path} className="ui-link t-ui-m break-anywhere font-semibold">
                        {p.landmark.name}
                      </Link>
                    )}
                    <span className="t-ui-s muted block break-anywhere">{landmarkSummary(p.spots)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function LandmarkPageView({ page }: { page: LandmarkPage }) {
  const median = getStats().index_median;
  const month = formatMonthYear(getGeneratedAt());
  const { landmark, spots } = page;
  const title = landmarkTitle(landmark);
  const path = landmarkPath(landmark);
  const crumbs = crumbsFor(page);
  const answer = landmarkSentence(landmark, spots, month);

  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, path),
          itemListNode(SITE_URL, {
            name: title,
            order: "ascending",
            entries: spots.map((s) => ({ name: s.restaurant.name, path: `/restaurants/${s.restaurant.id}` })),
          }),
        ]}
      />
      <PageHeader crumbs={crumbs} ticket={LANDMARKS_TICKET} ticketIcon={LANDMARK_TICKET_ICON} title={`${title}.`} lede={answer} />
      <div className="wrap">
        <section className="mt-2" aria-label={title}>
          <LandmarkTable spots={spots} median={median} caption={title} />
          <p className="t-ui-s muted mt-3">{landmarkCountLine(spots.length)}</p>
          <p className="mt-6">
            <Link href={landmarkMapHref(landmark)} className="btn btn-secondary">
              <MapPin strokeWidth={2} aria-hidden="true" />
              See them on the map
            </Link>
          </p>
        </section>

        <section className="section" aria-labelledby="other-landmarks">
          <SectionHeading id="other-landmarks" title="Burgers near other landmarks." />
          <div className="mt-6">
            <LandmarkLinks pages={landmarkPages()} current={path} />
          </div>
        </section>
      </div>
    </>
  );
}
