import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyField } from "@/components/CopyField";
import { Anchor, MessageBottle, Net, OrderBell, Spyglass } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { BoroughName, Money, PageHeader, PriceChip, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { medianClause } from "@/lib/answers";
import { BADGE_PAGE_PATH } from "@/lib/badge";
import { CONTACT_URL } from "@/lib/contact";
import { CSV_LICENSE, CSV_PATH } from "@/lib/csv";
import { getBoroughs, getGeneratedAt, getMenuCounts, getPricedRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { formatCount, formatDate, formatMonthYear, formatPrice, pluralize, spreadEnds, theBurger } from "@/lib/format";
import { breadcrumbNode } from "@/lib/jsonld";
import { OG_IMAGE, pageMetadata, SITE_URL } from "@/lib/metadata";
import { menusByIndexPrice, menusByIndexPriceDesc } from "@/lib/menus";
import { pressCitation, PRESS_PATH } from "@/lib/press";
import { pressSeo, sourceLine } from "@/lib/seo";
import { PEOPLES_TOP_PATH, SITE_NAME } from "@/lib/site";

const generatedAt = getGeneratedAt();
const stats = getStats();
const menus = getMenuCounts().menus;

export const metadata: Metadata = pageMetadata({
  ...pressSeo({ median: stats.index_median, menus, locations: stats.restaurants_priced, generatedAt }),
  path: PRESS_PATH,
});

const money = (v: number) => formatPrice(v, { cents: "always" });

/**
 * The press kit (user decision 2026-09-25, stage 4; DESIGN.md "Press kit"): the headline numbers from the
 * dataset, the source and date line, the CSV with its license and a credit line to copy, the share image,
 * a short description and the contact (the GitHub repository's issues: the site publishes no email
 * address). Numbers and labels only, like every page (DESIGN.md "No methodology copy").
 */
export default function PressPage() {
  const median = stats.index_median;
  const restaurants = getPricedRestaurants();
  const cheapest = menusByIndexPrice(restaurants)[0];
  const priciest = menusByIndexPriceDesc(restaurants)[0];
  const ranked = rankedNeighborhoods();
  const hoodEnds = spreadEnds(ranked, (n) => n.index_median);
  const boroughs = getBoroughs().filter((b) => b.summary?.index_median != null && b.menuCounts.menus > 0);
  const crumbs = [{ href: "/", label: SITE_NAME }, { label: "Press kit" }];
  const month = formatMonthYear(generatedAt);

  return (
    <>
      <JsonLd nodes={[breadcrumbNode(SITE_URL, crumbs, PRESS_PATH)]} />
      <PageHeader
        crumbs={crumbs}
        ticket="Message in a bottle"
        ticketIcon={MessageBottle}
        title="Press kit."
        lede={median !== null ? `${medianClause(median, generatedAt)}. The numbers to quote, the data and how to credit it.` : "The numbers to quote, the data and how to credit it."}
      />
      <div className="wrap">
        {median !== null ? (
          <section className="mt-2" aria-labelledby="numbers">
            <h2 id="numbers" className="sr-only">
              The numbers
            </h2>
            <StatGrid>
              <StatTile icon={Anchor} label="NYC Burger Index" value={<Money value={median} />} sub={`Median of ${pluralize(menus, "menu")} at ${pluralize(stats.restaurants_priced, "restaurant")}`} />
              {priciest ? (
                <StatTile
                  icon={OrderBell}
                  label="Most expensive burger"
                  value={<Money value={priciest.indexPrice} />}
                  sub={
                    <>
                      {theBurger(priciest.restaurant.burger.name).replace(/^the /, "The ")} at{" "}
                      <Link href={`/restaurants/${priciest.restaurant.id}`} className="link">
                        {priciest.restaurant.name}
                      </Link>
                    </>
                  }
                />
              ) : null}
              {cheapest ? (
                <StatTile
                  icon={Net}
                  label="Cheapest burger spot"
                  value={<Money value={cheapest.indexPrice} />}
                  sub={
                    <>
                      The priciest burger at{" "}
                      <Link href={`/restaurants/${cheapest.restaurant.id}`} className="link">
                        {cheapest.restaurant.name}
                      </Link>
                    </>
                  }
                />
              ) : null}
              <StatTile icon={Spyglass} label="Updated" value={formatDate(generatedAt)} sub="Prices in US dollars, before tax and tip" />
            </StatGrid>

            {boroughs.length ? (
              <div className="table-shell mt-10 max-w-3xl">
                <table className="data-table">
                  <caption className="sr-only">Median burger price by borough</caption>
                  <thead>
                    <tr>
                      <th scope="col">Borough</th>
                      <th scope="col" className="num">
                        Median
                      </th>
                      <th scope="col" className="num">
                        Menus
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {boroughs.map((b) => (
                      <tr key={b.slug}>
                        <th scope="row">
                          <BoroughName borough={b.name} />
                        </th>
                        <td className="num">
                          <PriceChip price={b.summary?.index_median ?? null} median={median} />
                        </td>
                        <td className="num">{formatCount(b.menuCounts.menus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {hoodEnds ? (
              <p className="t-body prose-width mt-8">
                Of the {formatCount(ranked.length)} ranked neighborhoods,{" "}
                <Link href={`/neighborhoods/${hoodEnds.top.slug}`} className="link">
                  {hoodEnds.top.name}
                </Link>{" "}
                has the highest median, {money(hoodEnds.top.index_median as number)}, and{" "}
                <Link href={`/neighborhoods/${hoodEnds.bottom.slug}`} className="link">
                  {hoodEnds.bottom.name}
                </Link>{" "}
                the lowest, {money(hoodEnds.bottom.index_median as number)}.
              </p>
            ) : null}
            <p className="t-ui-m mt-6">{sourceLine(generatedAt)}</p>
          </section>
        ) : null}

        <section className="section" aria-labelledby="data">
          <SectionHeading id="data" kicker="Cast a line" icon={Spyglass} title="Use the data." />
          <div className="prose-width mt-6">
            <p className="t-body">
              Every priced restaurant is one row of the price list: restaurant, neighborhood, borough, burger, price, source and a link to its page. It is
              free to use under{" "}
              <a href={CSV_LICENSE.url} className="link" rel="license">
                {CSV_LICENSE.name}
              </a>
              , with credit to The Burger Index.
            </p>
            <p className="mt-5">
              <a href={CSV_PATH} className="btn btn-primary" download>
                <Download strokeWidth={2} aria-hidden="true" />
                Download the prices (CSV)
              </a>
            </p>
            <div className="mt-8">
              <CopyField id="press-credit" label="Credit line" button="Copy the credit" rows={2} value={pressCitation(SITE_URL, generatedAt)} event={{ surface: "press", what: "citation" }} />
            </div>
            <p className="t-ui-m muted mt-4">Online, link to the page you quote: every restaurant, neighborhood, borough and ranking has its own.</p>
          </div>
        </section>

        <section className="section" aria-labelledby="image">
          <SectionHeading id="image" kicker="Hang it up" icon={Anchor} title="Share image." />
          <figure className="mt-6 max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- the static share image, shown as it is */}
            <img src={OG_IMAGE.url} width={OG_IMAGE.width} height={OG_IMAGE.height} alt={OG_IMAGE.alt} className="press-image" loading="lazy" />
            <figcaption className="t-ui-s muted mt-3">
              The Burger Index share image, {OG_IMAGE.width} × {OG_IMAGE.height}. Every restaurant, neighborhood, borough and ranking page has its own, with its
              name and price.
            </figcaption>
          </figure>
          <p className="mt-5">
            <a href={OG_IMAGE.url} className="btn btn-secondary" download="the-burger-index.png">
              <Download strokeWidth={2} aria-hidden="true" />
              Download the image (PNG)
            </a>
          </p>
        </section>

        <section className="section" aria-labelledby="about">
          <SectionHeading id="about" title="About The Burger Index." />
          <div className="t-body prose-width mt-6 grid gap-4">
            <p>
              The Burger Index is what a burger costs in New York City, {month}: the NYC median, prices by borough and neighborhood, a page for every priced
              restaurant, rankings and a map. Visitors rank the burgers they like best; together their lists make{" "}
              <Link href={PEOPLES_TOP_PATH} className="link">
                the People&rsquo;s Top 10
              </Link>
              .
            </p>
            <p>We index prices, not quality. It is an independent project, not affiliated with any restaurant.</p>
            <p>
              Restaurants on it can show their price with a{" "}
              <Link href={BADGE_PAGE_PATH} className="link">
                price badge
              </Link>
              .
            </p>
          </div>
        </section>

        <section className="section" aria-labelledby="contact">
          <SectionHeading id="contact" kicker="Ask the cook" icon={OrderBell} title="Get in touch." />
          <p className="t-body prose-width mt-6">
            Questions, corrections or interview requests:{" "}
            <a href={CONTACT_URL} className="link" rel="noopener">
              open an issue on GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </>
  );
}
