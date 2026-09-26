import Link from "next/link";
import { BEST_BURGERS_NAME, BEST_BURGERS_PATH } from "@/lib/best-burgers";
import { CSV_LICENSE, CSV_PATH } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { BEST_VALUE_NAME, BEST_VALUE_PATH } from "@/lib/peoples-price";
import { CITY_RANKINGS, rankingName, rankingPath } from "@/lib/rankings";
import { sourceLine } from "@/lib/seo";
import { NAV } from "@/lib/site";
import { UseSystemTheme } from "./theme";
import { Wordmark } from "./Wordmark";

/**
 * The deck: a rope rail, then dark stained deck planks. The source line, the non-affiliation line, the
 * CSV link with its license and the NYC ranking pages ship on every page (with the best value burgers while
 * that page exists: `bestValue`).
 */
export function SiteFooter({ generatedAt, bestValue = false }: { generatedAt: string; bestValue?: boolean }) {
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
                {/* The public price list (user decision 2026-09-25), where the old JSON download sat, then its
                    license in small type (CC BY 4.0, user decision 2026-09-25). */}
                <li className="col-span-2">
                  <a className="deck-link" href={CSV_PATH} download>
                    Download the prices (CSV)
                  </a>
                  <span className="t-ui-s deck-muted mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <a className="deck-link t-ui-s" href={CSV_LICENSE.url} rel="license">
                    {CSV_LICENSE.name}
                    <span className="sr-only"> license</span>
                  </a>
                </li>
                <li className="col-span-2">
                  <UseSystemTheme />
                </li>
              </ul>
            </nav>
            {/* The NYC ranking pages and the most-recommended burgers; each borough's lists are linked from its
                borough page and every ranking page, each neighborhood's from its neighborhood page. */}
            <nav aria-labelledby="footer-rankings" className="mt-8">
              <h2 id="footer-rankings" className="t-label deck-muted">
                Rankings
              </h2>
              {/* Balanced lines: the long under-$N names never leave "$15" alone on a line. */}
              <ul className="t-ui-m mt-3 grid gap-y-2">
                {CITY_RANKINGS.map((spec) => (
                  <li key={rankingPath(spec)} className="text-balance">
                    <Link className="deck-link" href={rankingPath(spec)}>
                      {rankingName(spec)}
                    </Link>
                  </li>
                ))}
                <li className="text-balance">
                  <Link className="deck-link" href={BEST_BURGERS_PATH}>
                    {BEST_BURGERS_NAME}
                  </Link>
                </li>
                {bestValue ? (
                  <li className="text-balance">
                    <Link className="deck-link" href={BEST_VALUE_PATH}>
                      {BEST_VALUE_NAME}
                    </Link>
                  </li>
                ) : null}
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
