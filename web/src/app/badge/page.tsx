import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeFinder } from "@/components/badge/BadgeFinder";
import { BadgePreview, type BadgeContext } from "@/components/badge/BadgePreview";
import { OrderBell, Spatula, Spyglass } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { PageHeader, SectionHeading } from "@/components/ui";
import { BADGE_PAGE_NAME, BADGE_PAGE_PATH, type BadgeSpot } from "@/lib/badge";
import { CONTACT_URL } from "@/lib/contact";
import { getGeneratedAt, getNeighborhoods, getPricedRestaurants, getStats } from "@/lib/data";
import { breadcrumbNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { badgePageSeo } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  ...badgePageSeo({ restaurants: getPricedRestaurants().length, median: getStats().index_median }),
  path: BADGE_PAGE_PATH,
});

/** The example the page shows before a restaurant is picked: the priced restaurant nearest the NYC median. */
function exampleSpot(): BadgeSpot | null {
  const median = getStats().index_median ?? 0;
  const [r] = [...getPricedRestaurants()].sort((a, b) => Math.abs(a.index_price - median) - Math.abs(b.index_price - median) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return r ? { id: r.id, name: r.name, hood: r.neighborhood_slug, borough: r.borough, price: r.index_price } : null;
}

/**
 * The price badge (user decision 2026-09-25, stage 4; DESIGN.md "Price badge"): what it is, the badge of the
 * restaurant a restaurant page sent the visitor for (`?r=<id>`) or an example, a finder for any priced
 * restaurant, and how to put it on a website. The badges themselves are static SVGs (app/badge/[file]).
 */
export default function BadgePage() {
  const example = exampleSpot();
  const context: BadgeContext = {
    site: SITE_URL,
    cityMedian: getStats().index_median,
    generatedAt: getGeneratedAt(),
    hoods: Object.fromEntries(getNeighborhoods().map((n) => [n.slug, n.name])),
  };
  const crumbs = [{ href: "/", label: SITE_NAME }, { label: "Price badge" }];
  return (
    <>
      <JsonLd nodes={[breadcrumbNode(SITE_URL, crumbs, BADGE_PAGE_PATH)]} />
      <PageHeader
        crumbs={crumbs}
        ticket="For restaurants"
        ticketIcon={OrderBell}
        title="A price badge for your restaurant."
        lede="Show your burger's price on your own website: a small sign with the price listed here and how it compares with the NYC median, linked to your restaurant's page on The Burger Index. Free, with no sign-up."
      />
      <div className="wrap">
        <section className="mt-2 max-w-3xl" aria-labelledby="get-badge">
          <h2 id="get-badge" className="sr-only">
            {BADGE_PAGE_NAME}
          </h2>
          {example ? (
            // The badge a restaurant page's link asks for (?r=<id>) is picked in the browser; the static HTML
            // carries the example.
            <Suspense fallback={<BadgePreview spot={example} context={context} example />}>
              <BadgeFinder example={example} context={context} />
            </Suspense>
          ) : (
            <p className="t-ui-m">No restaurant has a price yet, so there are no badges yet.</p>
          )}
        </section>

        <section className="section" aria-labelledby="how">
          <SectionHeading id="how" kicker="Hang it up" icon={Spatula} title="How to add it." />
          <ol className="steps t-body prose-width mt-6">
            <li>Find your restaurant above, or follow &ldquo;Get its price badge&rdquo; at the foot of its page here.</li>
            <li>Copy the HTML.</li>
            <li>
              Paste it into your website where the badge should go: the footer, the menu page or the About page. Squarespace, Wix, WordPress and
              most other site builders have an HTML or embed block for it.
            </li>
          </ol>
        </section>

        <section className="section" aria-labelledby="fine-print">
          <SectionHeading id="fine-print" kicker="The fine print" icon={Spyglass} title="Good to know." />
          <ul className="steps steps-plain t-body prose-width mt-6">
            <li>The badge shows the price on your page here and how it compares with the NYC median, with the month. When your page changes, so does the badge.</li>
            <li>It is a plain image with a link: no script, no cookie.</li>
            <li>Please use it as it is: don&rsquo;t edit the image or its numbers.</li>
            <li>
              Is a price out of date? <a href={CONTACT_URL} className="link" rel="noopener">Tell us on GitHub</a>.
            </li>
          </ul>
          <p className="t-ui-m mt-8">
            <Link href="/press" className="link">
              Writing about burger prices? See the press kit.
            </Link>
          </p>
        </section>
      </div>
    </>
  );
}
