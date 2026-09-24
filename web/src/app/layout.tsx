import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Libre_Franklin, Newsreader } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getDataSource, getGeneratedAt, getIndexMedian, getMenuCounts, getScope, getStats } from "@/lib/data";
import { formatPrice, pluralize } from "@/lib/format";
import { OG_IMAGE, SITE_URL } from "@/lib/metadata";
import { coverageSentence, scopeCredit } from "@/lib/scope";
import { SITE_NAME } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], display: "swap", axes: ["opsz"], variable: "--bs", adjustFontFallback: false, fallback: ["Arial Narrow", "sans-serif"] });
const body = Newsreader({ subsets: ["latin"], display: "swap", axes: ["opsz"], style: ["normal", "italic"], variable: "--nr" });
const ui = Libre_Franklin({ subsets: ["latin"], display: "swap", variable: "--lf" });

const median = getIndexMedian();
const scope = getScope();
// While part of the restaurant list is unread, the description says how much is read so far.
const soFar = scope.pending ? ` ${coverageSentence(scope)}` : "";
const description =
  median !== null
    ? `The NYC Burger Index${scope.pending ? " so far" : ""}: ${formatPrice(median)} is the median price of the cheapest beef burger across ${pluralize(getMenuCounts().menus, "New York menu")}, each chain counted once.${soFar} Every burger we priced, by borough, neighborhood and restaurant.`
    : `What a burger costs in New York: every burger we priced, by borough, neighborhood and restaurant.${soFar}`;

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
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
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
          className="sr-only z-50 bg-surface px-4 py-3 t-ui-m focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-[4px]"
        >
          Skip to content
        </a>
        {source === "fixture" ? (
          <div role="note" className="border-b border-line bg-warn-bg">
            <p className="wrap t-ui-s py-2">
              <strong className="font-semibold">Sample data.</strong> These restaurants and prices are made up for development. Run the
              pipeline to publish the real index.
            </p>
          </div>
        ) : null}
        <SiteHeader />
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <SiteFooter generatedAt={getGeneratedAt()} menus={getMenuCounts().menus} locations={getStats().restaurants_priced} listCredit={scopeCredit(scope)} />
      </body>
    </html>
  );
}
