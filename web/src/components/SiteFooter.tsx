import Link from "next/link";
import { CSV_PATH } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { CITY_RANKINGS, rankingName, rankingPath } from "@/lib/rankings";
import { sourceLine } from "@/lib/seo";
import { NAV } from "@/lib/site";
import { UseSystemTheme } from "./theme";
import { Wordmark } from "./Wordmark";

/**
 * The deck: a rope rail, then dark stained deck planks. The source line, the non-affiliation line, the
 * CSV link and the NYC ranking pages ship on every page.
 */
export function SiteFooter({ generatedAt }: { generatedAt: string }) {
  return (
    <footer className="site-footer atmo">
      <span className="rope rope-flat" aria-hidden="true" />
      <div className="deck">
        <div className="wrap grid gap-10 md:grid-cols-3 md:gap-8">
          <div className="min-w-0">
            <p>
              <Wordmark />
            </p>
            <p className="t-ui-m mt-4">Updated {formatDate(generatedAt)}</p>
            {/* The one sourcing sentence (user decision 2026-09-25); the other is next to the home board. */}
            <p className="t-ui-s deck-muted mt-2">{sourceLine(generatedAt)}</p>
            <p className="t-ui-s deck-muted mt-2">Prices in US dollars, before tax and tip.</p>
          </div>
          <div className="min-w-0">
            <nav aria-label="Footer">
              <ul className="t-ui-m grid grid-cols-2 gap-x-6 gap-y-2">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link className="deck-link" href={item.href}>
                      {item.label}
                    </Link>
                  </li>
                ))}
                {/* The public price list (user decision 2026-09-25), where the old JSON download sat. */}
                <li className="col-span-2">
                  <a className="deck-link" href={CSV_PATH} download>
                    Download the prices (CSV)
                  </a>
                </li>
                <li className="col-span-2">
                  <UseSystemTheme />
                </li>
              </ul>
            </nav>
            {/* The NYC ranking pages; each borough's lists are linked from its borough page and every ranking page. */}
            <nav aria-labelledby="footer-rankings" className="mt-8">
              <h2 id="footer-rankings" className="t-label deck-muted">
                Rankings
              </h2>
              <ul className="t-ui-m mt-3 grid gap-y-2">
                {CITY_RANKINGS.map((spec) => (
                  <li key={rankingPath(spec)}>
                    <Link className="deck-link" href={rankingPath(spec)}>
                      {rankingName(spec)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
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
