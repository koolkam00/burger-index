import { ImageResponse } from "next/og";
import { Board, BoardLine, BoardPrice, C, OG_HEIGHT, OG_WIDTH, ogFonts, Sea } from "@/components/og/board";
import { getGeneratedAt, getMenuCounts, getStats } from "@/lib/data";
import { formatDate, pluralize } from "@/lib/format";

// The Open Graph image is the Order Board at 1200×630 (DESIGN.md "Open Graph image"): sea water, the
// awning across the top, the yellow board with its plaque and life ring, and the wordmark on a wood
// strip. Flat fills, linear gradients and inline SVG only (Satori has no masks or repeating
// gradients); the pieces are shared with every page's own share image (components/og/board.tsx).
// Rendered once at build time and written to out/og.png by the static export.
export const dynamic = "force-static";

export async function GET() {
  const median = getStats().index_median;
  // The board's small print, as on the home page.
  const line = [pluralize(getMenuCounts().menus, "menu"), `Updated ${formatDate(getGeneratedAt())}`];

  return new ImageResponse(
    (
      <Sea>
        <Board width={900}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 600, letterSpacing: "0.1em" }}>THE BURGER INDEX · NYC MEDIAN</div>
          {median !== null ? (
            <BoardPrice value={median} size={260} />
          ) : (
            <div style={{ display: "flex", fontFamily: "Lilita One", fontSize: 120, lineHeight: 1, color: C.signPrice, marginTop: 16 }}>What a burger costs in New York</div>
          )}
          <BoardLine parts={line} />
        </Board>
      </Sea>
    ),
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: await ogFonts() },
  );
}
