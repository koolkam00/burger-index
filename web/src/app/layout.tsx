import type { Metadata, Viewport } from "next";
import { Barlow, Lilita_One, Nunito } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getDataSource, getGeneratedAt, getIndexMedian, getMenuCounts, getStats } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { OG_IMAGE, SITE_URL } from "@/lib/metadata";
import { SITE_NAME } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// DESIGN.md "Typography": Lilita One (display: the board, headings, stat values, wordmark), Nunito
// (body prose) and Barlow (UI and every aligned number; its tabular figures were measured to work).
const display = Lilita_One({ subsets: ["latin"], weight: "400", display: "swap", variable: "--lo", adjustFontFallback: false, fallback: ["Arial Rounded MT Bold", "Arial Black", "sans-serif"] });
const body = Nunito({ subsets: ["latin"], display: "swap", style: ["normal", "italic"], variable: "--nu" });
const ui = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--ba" });

const median = getIndexMedian();
const description =
  median !== null
    ? `The NYC Burger Index: ${formatPrice(median)}. Every burger we priced, by borough, neighborhood and restaurant.`
    : "What a burger costs in New York: every burger we priced, by borough, neighborhood and restaurant.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: what a burger costs in New York`, template: `%s · ${SITE_NAME}` },
  description,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: `${SITE_NAME}: what a burger costs in New York`,
    description,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6ECD6" },
    { media: "(prefers-color-scheme: dark)", color: "#081B25" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const source = getDataSource();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${ui.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-50 bg-surface px-4 py-3 t-ui-m focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-[10px] focus:px-4 focus:py-3 focus:shadow-[0_0_0_8px_var(--focus-halo)]"
        >
          Skip to content
        </a>
        {source === "fixture" ? (
          <div role="note" className="border-b border-line bg-warn-bg">
            <p className="wrap t-ui-s py-2">
              <strong className="font-bold">Sample data.</strong> These restaurants and prices are made up for development. Run the
              pipeline to publish the real index.
            </p>
          </div>
        ) : null}
        <SiteHeader />
        {/* The awning: red and cream scalloped stripes under the facade. Not sticky; it overlaps the
            band below by its own height. */}
        <div className="awning-wrap" aria-hidden="true">
          <div className="awning" />
        </div>
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <SiteFooter generatedAt={getGeneratedAt()} menus={getMenuCounts().menus} locations={getStats().restaurants_priced} />
      </body>
    </html>
  );
}
