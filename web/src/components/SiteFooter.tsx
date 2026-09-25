import Link from "next/link";
import { formatDate, pluralize } from "@/lib/format";
import { NAV } from "@/lib/site";
import { UseSystemTheme } from "./theme";
import { Wordmark } from "./Wordmark";

/** The deck: a rope rail, then dark stained deck planks. The non-affiliation line ships on every page. */
export function SiteFooter({ generatedAt, menus, locations }: { generatedAt: string; menus: number; locations: number }) {
  return (
    <footer className="site-footer atmo">
      <span className="rope rope-flat" aria-hidden="true" />
      <div className="deck">
        <div className="wrap grid gap-10 md:grid-cols-3 md:gap-8">
          <div className="min-w-0">
            <p>
              <Wordmark />
            </p>
            <p className="t-ui-m mt-4">
              Updated {formatDate(generatedAt)} · {pluralize(menus, "menu")} at {pluralize(locations, "location")} priced
            </p>
            <p className="t-ui-s deck-muted mt-2">Prices in US dollars, before tax and tip.</p>
          </div>
          <nav aria-label="Footer" className="min-w-0">
            <ul className="t-ui-m grid grid-cols-2 gap-x-6 gap-y-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link className="deck-link" href={item.href}>
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="col-span-2">
                <a className="deck-link" href="/data/burger_index.json" download>
                  Download the data (JSON)
                </a>
              </li>
              <li className="col-span-2">
                <UseSystemTheme />
              </li>
            </ul>
          </nav>
          <div className="min-w-0">
            <p className="t-body-s deck-muted">
              We index prices, not quality. An original seaside-diner homage: not affiliated with any restaurant, TV show or network.
            </p>
            <p className="t-body-s deck-muted mt-3">Map data © OpenStreetMap contributors, tiles by OpenFreeMap.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
