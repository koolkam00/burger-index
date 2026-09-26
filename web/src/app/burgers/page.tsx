import { Suspense } from "react";
import { BurgerExplorer } from "@/components/burgers/BurgerExplorer";
import { BurgerTable } from "@/components/burgers/BurgerTable";
import { Spyglass } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { RankingLinks } from "@/components/Rankings";
import { PageHeader, SectionHeading } from "@/components/ui";
import { getGeneratedAt, getPricedRestaurants } from "@/lib/data";
import { buildExplorerData } from "@/lib/explorer-data";
import { formatCount, formatPrice } from "@/lib/format";
import { breadcrumbNode } from "@/lib/jsonld";
import { menusByIndexPrice, menusByIndexPriceDesc } from "@/lib/menus";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { rankingSpecs } from "@/lib/rankings";
import { burgersSeo } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

const cheapest = menusByIndexPrice(getPricedRestaurants())[0];
const priciest = menusByIndexPriceDesc(getPricedRestaurants())[0];

export const metadata = pageMetadata({
  ...burgersSeo({
    count: getPricedRestaurants().length,
    generatedAt: getGeneratedAt(),
    cheapest: cheapest ? { name: cheapest.restaurant.name, price: cheapest.indexPrice } : null,
    priciest: priciest ? { name: priciest.restaurant.name, price: priciest.indexPrice } : null,
  }),
  path: "/burgers",
});

export default function BurgersPage() {
  const data = buildExplorerData();
  const total = formatCount(data.rows.length);
  // Static first paint (and the no-JS view): the first 50 burgers by price, lowest first. The
  // filterable explorer reads the URL, so it renders on the client inside <Suspense>.
  const preview = [...data.rows].sort((a, b) => a.price - b.price || a.burger.localeCompare(b.burger)).slice(0, 50);
  // "548 burgers, from $6 to $75.": the count, then the cheapest and priciest prices on the list.
  const ends = cheapest && priciest ? `, from ${formatPrice(cheapest.indexPrice)} to ${formatPrice(priciest.indexPrice)}` : "";

  return (
    <>
      <JsonLd nodes={[breadcrumbNode(SITE_URL, [{ href: "/", label: SITE_NAME }, { label: "Every burger" }], "/burgers")]} />
      <PageHeader ticket="Cast a line" ticketIcon={Spyglass} title="Every burger." lede={`${total} burgers${ends}. Search by name, restaurant or neighborhood.`} />
      <div className="wrap mt-2">
        <Suspense
          fallback={
            <div>
              <p className="t-ui-m muted mb-3">
                Showing {formatCount(preview.length)} of {total} burgers, lowest price first
              </p>
              <BurgerTable rows={preview} median={data.median} sort="price" />
            </div>
          }
        >
          <BurgerExplorer data={data} />
        </Suspense>

        {/* The ranking pages: the same burgers as short, fixed lists (a chain once). */}
        <section className="section" aria-labelledby="rankings">
          <SectionHeading id="rankings" title="Burger rankings." />
          <div className="mt-6">
            <RankingLinks available={rankingSpecs(getPricedRestaurants())} />
          </div>
        </section>
      </div>
    </>
  );
}
