import { Suspense } from "react";
import { BurgerExplorer } from "@/components/burgers/BurgerExplorer";
import { BurgerTable, type TableRow } from "@/components/burgers/BurgerTable";
import { PageHeader } from "@/components/ui";
import { buildExplorerData } from "@/lib/explorer-data";
import { formatCount } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Every burger",
  description: "Search and filter every burger on every New York menu we priced, by borough, neighborhood, protein, price and source.",
  path: "/burgers",
});

export default function BurgersPage() {
  const data = buildExplorerData();
  const priced = data.burgers.filter((b) => b.price !== null).length;
  // Static first paint (and the no-JS view): the 50 cheapest burgers. The filterable explorer
  // reads the URL, so it renders on the client inside <Suspense>.
  const preview: TableRow[] = data.burgers
    .filter((b) => b.price !== null)
    .sort((a, b) => (a.price as number) - (b.price as number) || a.name.localeCompare(b.name))
    .slice(0, 50)
    .map((b) => ({ b, r: data.restaurants[b.r] }));

  return (
    <div className="wrap">
      <PageHeader
        title="Every burger."
        lede={`All ${formatCount(data.burgers.length)} burgers we found on New York menus, ${formatCount(priced)} of them with a price, one row per location: a chain's menu repeats at each of its locations. Search by name, restaurant or neighborhood; the index price is the cheapest beef burger at each place.`}
      />
      <div className="mt-8">
        <Suspense
          fallback={
            <div>
              <p className="t-ui-m muted mb-3">
                Showing the {formatCount(preview.length)} cheapest of {formatCount(data.burgers.length)} burgers
              </p>
              <BurgerTable rows={preview} median={data.median} sort="price" />
            </div>
          }
        >
          <BurgerExplorer data={data} />
        </Suspense>
      </div>
    </div>
  );
}
