// The restaurant price badge (lib/badge.ts; DESIGN.md "Price badge"): a small order board, the life ring
// beside the burger's price in red sign-painter letters, how it compares with the NYC median and the
// brand with the month. Theme-invariant like the board (it sits on other people's sites). Satori markup:
// app/badge/[file]/route.tsx turns it into an SVG with the text drawn as outlines.
import "server-only";

import type { BadgeText } from "@/lib/badge";
import { BADGE_HEIGHT, BADGE_WIDTH } from "@/lib/badge";
import { C, LifeRing } from "./board";

export function BadgeImage({ text }: { text: BadgeText }) {
  return (
    <div
      style={{
        width: BADGE_WIDTH,
        height: BADGE_HEIGHT,
        display: "flex",
        padding: 4,
        borderRadius: 14,
        backgroundColor: C.frame1,
        border: `1.5px solid ${C.nail}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: "100%",
          gap: 10,
          padding: "0 10px 0 9px",
          borderRadius: 10,
          backgroundColor: C.sign,
          color: C.signInk,
          fontFamily: "Barlow",
        }}
      >
        <LifeRing size={46} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", fontFamily: "Lilita One", fontSize: 25, lineHeight: 1, color: C.signPrice }}>{text.price}</div>
          {text.compare ? <div style={{ display: "flex", fontSize: 13, fontWeight: 600, lineHeight: 1.2, marginTop: 4 }}>{text.compare}</div> : null}
          <div style={{ display: "flex", fontSize: 12, fontWeight: 700, lineHeight: 1.2, letterSpacing: "0.06em", marginTop: 3 }}>{text.brand}</div>
        </div>
      </div>
    </div>
  );
}
