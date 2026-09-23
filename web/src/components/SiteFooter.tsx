import Link from "next/link";
import { formatCount, formatDate } from "@/lib/format";
import { NAV } from "@/lib/site";
import { UseSystemTheme } from "./theme";

export function SiteFooter({ generatedAt, priced }: { generatedAt: string; priced: number }) {
  return (
    <footer className="mt-12 md:mt-24">
      <div className="wrap">
        <div className="grid gap-8 border-t-2 border-ink py-12 md:grid-cols-3">
          <div className="min-w-0">
            <p className="wordmark">
              <span className="wordmark-the">The</span>Burger Index
            </p>
            <p className="t-ui-m mt-3">
              Updated {formatDate(generatedAt)} · {formatCount(priced)} restaurants priced
            </p>
            <p className="t-ui-s muted mt-2">Prices in US dollars, before tax and tip.</p>
          </div>
          <nav aria-label="Footer" className="min-w-0">
            <ul className="t-ui-m grid grid-cols-2 gap-x-6 gap-y-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link className="ui-link" href={item.href}>
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a className="ui-link" href="/data/burger_index.json" download>
                  Download the data (JSON)
                </a>
              </li>
              <li>
                <UseSystemTheme />
              </li>
            </ul>
          </nav>
          <div className="min-w-0">
            <p className="t-body-s muted">We index prices, not quality. Not affiliated with any restaurant.</p>
            <p className="t-body-s muted mt-3">
              Restaurant list from NYC Open Data (DOHMH). Map data © OpenStreetMap contributors, tiles by OpenFreeMap.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
