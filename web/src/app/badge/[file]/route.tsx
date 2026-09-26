import satori from "satori";
import { BadgeImage } from "@/components/og/BadgeImage";
import { ogFonts } from "@/components/og/board";
import { BADGE_HEIGHT, BADGE_WIDTH, badgeText } from "@/lib/badge";
import { getGeneratedAt, getPricedRestaurant, getPricedRestaurants, getStats } from "@/lib/data";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "@/lib/site";
import { compactSvgPaths } from "@/lib/svg-path";

// The price badge of every priced restaurant (user decision 2026-09-25; lib/badge.ts): /badge/<id>.svg, drawn
// once at build time by Satori with its text as outlines (so it looks the same on any site, whatever fonts
// that site has) and written to out/ by the static export. Not pages: never in the sitemap.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return atLeastOneParam(
    getPricedRestaurants().map((r) => ({ file: `${r.id}.svg` })),
    { file: `${PLACEHOLDER_PARAM}.svg` },
  );
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(_request: Request, { params }: RouteContext<"/badge/[file]">) {
  const { file } = await params;
  const r = file.endsWith(".svg") ? getPricedRestaurant(file.slice(0, -".svg".length)) : undefined;
  if (!r) {
    // The placeholder a dataset with nothing priced builds (site.ts PLACEHOLDER_PARAM): an empty image.
    return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}"/>`, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
  }
  const text = badgeText({ price: r.index_price, cityMedian: getStats().index_median, generatedAt: getGeneratedAt() });
  // The outlines rewritten relative to the pen: the same drawing at about half the size (lib/svg-path.ts).
  const svg = compactSvgPaths(await satori(<BadgeImage text={text} />, { width: BADGE_WIDTH, height: BADGE_HEIGHT, fonts: await ogFonts() }));
  // An accessible name for the image when it is opened on its own (the snippet's <img> carries alt text).
  const titled = svg.replace(/^<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs} role="img" aria-label="${escapeXml(text.label)}"><title>${escapeXml(text.label)}</title>`);
  return new Response(titled, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}
