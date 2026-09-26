// The Order Board drawn for Satori (next/og ImageResponse): the pieces the social images share
// (DESIGN.md "Open Graph image" and "Share images"). The site-wide /og.png and every page's own share
// image (/og/<page path>.png) are built from them at build time. Flat fills, linear gradients and inline
// SVG only: Satori has no masks and no repeating gradients. Server-only: the fonts are read from
// node_modules/@fontsource.
import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { priceParts } from "@/lib/format";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Day-shift token values (DESIGN.md "Color"): the images are the same in both themes, like the board. */
export const C = {
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

async function font(pkg: string, file: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: "normal" };
let fontsOnce: Promise<OgFont[]> | null = null;

/** Lilita One 400 and Barlow 500/600/700 (`.woff`, which Satori reads), loaded once per build worker. */
export function ogFonts(): Promise<OgFont[]> {
  fontsOnce ??= Promise.all([
    font("lilita-one", "lilita-one-latin-400-normal.woff"),
    font("barlow", "barlow-latin-500-normal.woff"),
    font("barlow", "barlow-latin-600-normal.woff"),
    font("barlow", "barlow-latin-700-normal.woff"),
  ]).then(([display, ui500, ui600, ui700]) => [
    { name: "Lilita One", data: display, weight: 400, style: "normal" },
    { name: "Barlow", data: ui500, weight: 500, style: "normal" },
    { name: "Barlow", data: ui600, weight: 600, style: "normal" },
    { name: "Barlow", data: ui700, weight: 700, style: "normal" },
  ]);
  return fontsOnce;
}

/** The awning: 36px stripes with one 18px scallop each (drawn, since Satori can't mask). */
export function Awning() {
  const stripes = Array.from({ length: Math.ceil(OG_WIDTH / 36) }, (_, i) => i);
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

export function LifeRing({ size }: { size: number }) {
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

/** A vertical hanger: alternating rope bands (Satori has no repeating gradients). */
export function Rope({ left, top = 18, height = 40 }: { left: number; top?: number; height?: number }) {
  return (
    <div style={{ position: "absolute", top, left, width: 8, height, display: "flex", flexDirection: "column", borderRadius: 4, overflow: "hidden" }}>
      {Array.from({ length: Math.ceil(height / 5) }, (_, i) => (
        <div key={i} style={{ width: 8, height: 5, backgroundColor: i % 2 ? C.rope2 : C.rope1 }} />
      ))}
    </div>
  );
}

/** The whole image: sea water, the awning across the top and the wordmark on a wood strip along the bottom. */
export function Sea({ children }: { children: ReactNode }) {
  return (
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
      {children}
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
  );
}

/**
 * The Order Board rig: the beam, two rope hangers and the framed yellow sign with its "ORDER UP!" plaque
 * and the life ring on the lower-left corner. `children` go on the sign's face (centered).
 */
export function Board({
  width,
  children,
  marginTop = 44,
  hang = 36,
  facePadding = "34px 48px 34px",
}: {
  width: number;
  children: ReactNode;
  marginTop?: number;
  /** How far the sign hangs below the beam (the ropes' length). */
  hang?: number;
  facePadding?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width, marginTop, position: "relative" }}>
      <div style={{ display: "flex", height: 18, borderRadius: 4, backgroundColor: C.frame2, boxShadow: "0 3px 0 rgba(0,0,0,0.18)" }} />
      <Rope left={Math.round(width * 0.15) - 4} height={hang + 4} />
      <Rope left={Math.round(width * 0.85) - 4} height={hang + 4} />
      <div
        style={{
          display: "flex",
          position: "relative",
          marginTop: hang,
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
            padding: facePadding,
            borderRadius: 12,
            backgroundColor: C.sign,
            backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%)",
          }}
        >
          {children}
        </div>
        {/* "ORDER UP!" plaque on the frame's top edge, and the life ring on the lower-left corner */}
        <div
          style={{
            position: "absolute",
            top: -22,
            left: width / 2 - 105,
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
  );
}

/** The board's overline: `label` type, tracked caps. */
export function Overline({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", textAlign: "center", fontSize: size, fontWeight: 600, letterSpacing: "0.1em", lineHeight: 1.2 }}>
      {children}
    </div>
  );
}

/** The price in red sign-painter numerals with the drop shade and deli-card cents (the board's display-xl). */
export function BoardPrice({ value, size, marginTop = 8 }: { value: number; size: number; marginTop?: number }) {
  const parts = priceParts(value);
  const shade = `${Math.round(size * 0.022)}px ${Math.round(size * 0.03)}px 0 ${C.signShade}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        fontFamily: "Lilita One",
        fontSize: size,
        lineHeight: 0.9,
        color: C.signPrice,
        textShadow: shade,
        marginTop,
      }}
    >
      <span style={{ fontSize: size / 2, lineHeight: 1, marginTop: Math.round(size * 0.054) }}>$</span>
      <span>{parts.dollars}</span>
      <span style={{ display: "flex", flexDirection: "column", fontSize: size * 0.45, lineHeight: 1, marginTop: Math.round(size * 0.054), marginLeft: Math.round(size * 0.046) }}>
        <span>{parts.cents}</span>
        <span style={{ height: Math.max(4, Math.round(size * 0.035)), backgroundColor: C.signPrice, marginTop: Math.round(size * 0.023) }} />
      </span>
    </div>
  );
}

/** The board's small print: parts joined by " ·", each part a unit; the gap after "·" matches a word space. */
export function BoardLine({ parts, size = 26, marginTop = 12 }: { parts: readonly string[]; size?: number; marginTop?: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: Math.round(size * 0.27), rowGap: 4, fontSize: size, fontWeight: 500, marginTop }}>
      {parts.map((part, i) => (
        <span key={i}>{i < parts.length - 1 ? `${part} ·` : part}</span>
      ))}
    </div>
  );
}
