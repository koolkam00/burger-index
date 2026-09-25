import { Suspense } from "react";
import { BurgerExplorer } from "@/components/burgers/BurgerExplorer";
import { BurgerTable } from "@/components/burgers/BurgerTable";
import { Spyglass } from "@/components/icons/nautical";
import { PageHeader } from "@/components/ui";
import { buildExplorerData } from "@/lib/explorer-data";
import { formatCount } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Every burger",
  description: "Search and filter every burger on every New York menu we priced, by borough, neighborhood and price.",
  path: "/burgers",
});

export default function BurgersPage() {
  const data = buildExplorerData();
  const total = formatCount(data.rows.length);
  // Static first paint (and the no-JS view): the 50 cheapest burgers. The filterable explorer
  // reads the URL, so it renders on the client inside <Suspense>.
  const preview = [...data.rows].sort((a, b) => a.price - b.price || a.burger.localeCompare(b.burger)).slice(0, 50);

  return (
    <>
      <PageHeader ticket="Cast a line" ticketIcon={Spyglass} title="Every burger." lede={`All ${total} burgers. Search by name, restaurant or neighborhood.`} />
      <div className="wrap mt-2">
        <Suspense
          fallback={
            <div>
              <p className="t-ui-m muted mb-3">
                Showing the {formatCount(preview.length)} cheapest of {total} burgers
              </p>
              <BurgerTable rows={preview} median={data.median} sort="price" />
            </div>
          }
        >
          <BurgerExplorer data={data} />
        </Suspense>
      </div>
    </>
  );
}
