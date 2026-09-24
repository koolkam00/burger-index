import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getGeneratedAt, getMenuCounts, getScope, getStats } from "@/lib/data";
import { formatDate, pluralize, priceParts } from "@/lib/format";
import { lookedUpSoFar } from "@/lib/scope";

// The Open Graph image is the Letterboard at 1200×630 (DESIGN.md). Rendered once at build time and
// written to out/og.png by the static export.
export const dynamic = "force-static";

async function font(pkg: string, file: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function GET() {
  const stats = getStats();
  const median = stats.index_median;
  const parts = median !== null ? priceParts(median) : null;
  const [display, ui500, ui600] = await Promise.all([
    font("big-shoulders", "big-shoulders-latin-900-normal.woff"),
    font("libre-franklin", "libre-franklin-latin-500-normal.woff"),
    font("libre-franklin", "libre-franklin-latin-600-normal.woff"),
  ]);

  const ink = "#F8F3E7";
  const muted = "#B5AB9C";
  // The board's small print, as on the home page: while part of the restaurant list is unread, the
  // image says how much is read, so a shared card never reads as a finished citywide census.
  const line = [`Cheapest beef burger on ${pluralize(getMenuCounts().menus, "menu")}`, lookedUpSoFar(getScope()), `Updated ${formatDate(getGeneratedAt())}`].filter(
    (x): x is string => !!x,
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 72px",
          backgroundColor: "#181614",
          backgroundImage: "repeating-linear-gradient(180deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 7px, rgba(255,255,255,0.035) 7px, rgba(255,255,255,0.035) 8px)",
          border: "14px solid #3A352F",
          color: ink,
          fontFamily: "Libre Franklin",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, fontWeight: 600, letterSpacing: "0.08em", color: muted }}>THE BURGER INDEX · NYC MEDIAN</div>
        {parts ? (
          <div style={{ display: "flex", alignItems: "flex-start", fontFamily: "Big Shoulders", fontWeight: 900, fontSize: 300, lineHeight: 0.85, textShadow: "0 2px 0 rgba(0,0,0,0.55)" }}>
            <span style={{ fontSize: 150, lineHeight: 1, marginTop: 18 }}>$</span>
            <span>{parts.dollars}</span>
            <span style={{ display: "flex", flexDirection: "column", fontSize: 135, lineHeight: 1, marginTop: 18, marginLeft: 12 }}>
              <span>{parts.cents}</span>
              <span style={{ height: 8, backgroundColor: ink, marginTop: 6 }} />
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", fontFamily: "Big Shoulders", fontWeight: 900, fontSize: 200 }}>What a burger costs in New York</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", columnGap: 8, rowGap: 6, fontSize: 28, fontWeight: 500, color: muted }}>
          {line.map((part, i) => (
            <span key={i}>{i < line.length - 1 ? `${part} ·` : part}</span>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Big Shoulders", data: display, weight: 900, style: "normal" },
        { name: "Libre Franklin", data: ui500, weight: 500, style: "normal" },
        { name: "Libre Franklin", data: ui600, weight: 600, style: "normal" },
      ],
    },
  );
}
