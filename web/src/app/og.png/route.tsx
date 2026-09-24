import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getGeneratedAt, getMenuCounts, getScope, getStats } from "@/lib/data";
import { formatDate, pluralize, priceParts } from "@/lib/format";
import { lookedUpSoFar } from "@/lib/scope";

// The Open Graph image is the Order Board at 1200×630 (DESIGN.md "Open Graph image"): sea water, the
// awning across the top, the yellow board with its plaque and life ring, and the wordmark on a wood
// strip. Flat fills, linear gradients and inline SVG only (Satori has no masks or repeating
// gradients). Rendered once at build time and written to out/og.png by the static export.
export const dynamic = "force-static";

async function font(pkg: string, file: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Day-shift token values (DESIGN.md "Color").
const C = {
  seaTop: "#A7E3DC",
  seaBot: "#62C3C3",
  awningA: "#C4221B",
  awningB: "#FFF4DE",
  sign: "#FFCD3C",
  signInk: "#3A1F0C",
  signPrice: "#B0170F",
  signShade: "#3A1F0C",
  plaque: "#B0170F",
  plaqueInk: "#FFE08A",
  frame1: "#C68842",
  frame2: "#9A6128",
  nail: "#5A3410",
  rope1: "#E2C089",
  rope2: "#A77C45",
  brass: "#B8862E",
  brassLo: "#7A5415",
  wood: "#DDA764",
  woodInk: "#2B1B10",
  ringA: "#C4221B",
  ringB: "#FFF4DE",
  ringLine: "#2B1B10",
};

/** The awning: 36px stripes with one 18px scallop each (drawn, since Satori can't mask). */
function Awning() {
  const stripes = Array.from({ length: Math.ceil(1200 / 36) }, (_, i) => i);
  return (
    <svg width="1200" height="34" viewBox="0 0 1200 34" style={{ position: "absolute", top: 0, left: 0 }}>
      <rect x="0" y="3" width="1200" height="31" fill="rgba(0,0,0,0.12)" />
      {stripes.map((i) => (
        <g key={i} fill={i % 2 ? C.awningB : C.awningA}>
          <rect x={i * 36} y="0" width="36" height="12" />
          <circle cx={i * 36 + 18} cy="12" r="18" />
        </g>
      ))}
    </svg>
  );
}

function LifeRing({ size }: { size: number }) {
  const r = 7.75;
  const seg = ((2 * Math.PI * r) / 8).toFixed(3);
  const ticks = [45, 135, 225, 315].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    const p = (rr: number, f: (x: number) => number) => (12 + rr * f(a)).toFixed(2);
    return { x1: p(4.4, Math.cos), y1: p(4.4, Math.sin), x2: p(11.1, Math.cos), y2: p(11.1, Math.sin) };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r={r} fill="none" stroke={C.ringB} strokeWidth="5.5" />
      <circle cx="12" cy="12" r={r} fill="none" stroke={C.ringA} strokeWidth="5.5" strokeDasharray={`${seg} ${seg}`} transform="rotate(-112.5 12 12)" />
      <circle cx="12" cy="12" r="10.5" fill="none" stroke={C.ringLine} strokeWidth="1.3" />
      <circle cx="12" cy="12" r="5" fill="none" stroke={C.ringLine} strokeWidth="1.3" />
      {ticks.map((t, i) => (
        <line key={i} {...t} stroke={C.ringLine} strokeWidth="1.3" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function Rope({ left }: { left: number }) {
  // A vertical hanger: alternating rope bands (Satori has no repeating gradients).
  return (
    <div style={{ position: "absolute", top: 18, left, width: 8, height: 40, display: "flex", flexDirection: "column", borderRadius: 4, overflow: "hidden" }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ width: 8, height: 5, backgroundColor: i % 2 ? C.rope2 : C.rope1 }} />
      ))}
    </div>
  );
}

export async function GET() {
  const stats = getStats();
  const median = stats.index_median;
  const parts = median !== null ? priceParts(median) : null;
  const [display, ui500, ui600] = await Promise.all([
    font("lilita-one", "lilita-one-latin-400-normal.woff"),
    font("barlow", "barlow-latin-500-normal.woff"),
    font("barlow", "barlow-latin-600-normal.woff"),
  ]);

  // The board's small print, as on the home page: while part of the restaurant list is unread, the
  // image says how much is read, so a shared card never reads as a finished citywide census.
  const line = [`Cheapest beef burger on ${pluralize(getMenuCounts().menus, "menu")}`, lookedUpSoFar(getScope()), `Updated ${formatDate(getGeneratedAt())}`].filter(
    (x): x is string => !!x,
  );
  const W = 900; // board width
  const shade = `${Math.round(260 * 0.022)}px ${Math.round(260 * 0.03)}px 0 ${C.signShade}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          backgroundImage: `linear-gradient(180deg, ${C.seaTop}, ${C.seaBot})`,
          fontFamily: "Barlow",
          color: C.signInk,
        }}
      >
        <Awning />

        {/* The Order Board rig: beam, two rope hangers, the framed yellow sign. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: W, marginTop: 44, position: "relative" }}>
          <div style={{ display: "flex", height: 18, borderRadius: 4, backgroundColor: C.frame2, boxShadow: "0 3px 0 rgba(0,0,0,0.18)" }} />
          <Rope left={Math.round(W * 0.15) - 4} />
          <Rope left={Math.round(W * 0.85) - 4} />
          <div
            style={{
              display: "flex",
              position: "relative",
              marginTop: 36,
              padding: 16,
              borderRadius: 22,
              backgroundColor: C.frame1,
              boxShadow: "0 24px 30px -16px rgba(43,27,16,0.55)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                padding: "34px 48px 34px",
                borderRadius: 12,
                backgroundColor: C.sign,
                backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%)",
              }}
            >
              <div style={{ display: "flex", fontSize: 24, fontWeight: 600, letterSpacing: "0.1em" }}>THE BURGER INDEX · NYC MEDIAN</div>
              {parts ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    fontFamily: "Lilita One",
                    fontSize: 260,
                    lineHeight: 0.9,
                    color: C.signPrice,
                    textShadow: shade,
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontSize: 130, lineHeight: 1, marginTop: 14 }}>$</span>
                  <span>{parts.dollars}</span>
                  <span style={{ display: "flex", flexDirection: "column", fontSize: 117, lineHeight: 1, marginTop: 14, marginLeft: 12 }}>
                    <span>{parts.cents}</span>
                    <span style={{ height: 9, backgroundColor: C.signPrice, marginTop: 6 }} />
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", fontFamily: "Lilita One", fontSize: 120, lineHeight: 1, color: C.signPrice, marginTop: 16 }}>What a burger costs in New York</div>
              )}
              {/* columnGap matches a word space at 26px, so the gap after each "·" equals the one before it. */}
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: 7, rowGap: 4, fontSize: 26, fontWeight: 500, marginTop: 12 }}>
                {line.map((part, i) => (
                  <span key={i}>{i < line.length - 1 ? `${part} ·` : part}</span>
                ))}
              </div>
            </div>
            {/* "ORDER UP!" plaque on the frame's top edge, and the life ring on the lower-left corner */}
            <div
              style={{
                position: "absolute",
                top: -22,
                left: W / 2 - 105,
                width: 210,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: C.plaque,
                color: C.plaqueInk,
                fontFamily: "Lilita One",
                fontSize: 28,
                letterSpacing: "0.04em",
                borderRadius: 8,
                border: `3px solid ${C.nail}`,
                transform: "rotate(-2deg)",
              }}
            >
              ORDER UP!
            </div>
            {/* Raised so the whole ring clears the wood strip along the bottom of the image. */}
            <div style={{ position: "absolute", left: -30, bottom: -12, display: "flex", transform: "rotate(-14deg)" }}>
              <LifeRing size={92} />
            </div>
          </div>
        </div>

        {/* The wordmark on a wood strip along the bottom. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 66,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            backgroundColor: C.wood,
            borderTop: `6px solid ${C.rope2}`,
            color: C.woodInk,
          }}
        >
          <LifeRing size={40} />
          <div style={{ display: "flex", alignItems: "flex-start", fontFamily: "Lilita One", fontSize: 36, letterSpacing: "0.02em" }}>
            <span style={{ fontSize: 22, marginTop: 2, marginRight: 8 }}>THE</span>
            <span>BURGER INDEX</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Lilita One", data: display, weight: 400, style: "normal" },
        { name: "Barlow", data: ui500, weight: 500, style: "normal" },
        { name: "Barlow", data: ui600, weight: 600, style: "normal" },
      ],
    },
  );
}
