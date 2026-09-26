import { ImageResponse } from "next/og";
import { OG_HEIGHT, OG_WIDTH, ogFonts } from "@/components/og/board";
import { ShareCardImage } from "@/components/og/cards";
import { paletteSmaller } from "@/lib/png-palette";
import { shareCards } from "@/lib/share-cards";
import { pagePathOfSegments, shareImageSegments } from "@/lib/share-images";

// Each page's own share image (user decision 2026-09-25; DESIGN.md "Share images"): /og/<page path>.png
// for every restaurant, neighborhood, borough, ranking and style page and the most-recommended burgers,
// drawn once at build time, stored in 256 colors and written to out/ by the static export
// (lib/share-cards.ts has the cards).
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [...shareCards().keys()].map((page) => ({ path: shareImageSegments(page) }));
}

export async function GET(_request: Request, { params }: RouteContext<"/og/[...path]">) {
  const page = pagePathOfSegments((await params).path);
  const card = page ? shareCards().get(page) : undefined;
  if (!card) return new Response("Not found", { status: 404 });
  const png = await new ImageResponse(<ShareCardImage card={card} />, { width: OG_WIDTH, height: OG_HEIGHT, fonts: await ogFonts() }).arrayBuffer();
  // The same picture in 256 colors, about a third of the size (lib/png-palette.ts).
  return new Response(Uint8Array.from(paletteSmaller(new Uint8Array(png))), { headers: { "Content-Type": "image/png" } });
}
