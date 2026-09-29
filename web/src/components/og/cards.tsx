// A page's share image (DESIGN.md "Share images"): the Order Board over the water, carrying the page's own
// card (lib/share-images.ts). A board card (a restaurant or an area) is the name and one price; a list card
// (a ranking, the most-recommended burgers or a landmark page) is the page's H1 and its first rows; the home card is
// the People's Top 10, ten names in two columns, sized to read in a chat app's small preview. Satori-only markup.
import "server-only";

import type { ReactNode } from "react";
import { formatPrice } from "@/lib/format";
import { estimateLines, fitFontSize, type BoardCard, type ListCard, type ShareCard, type TopCard } from "@/lib/share-images";
import { Board, BoardLine, BoardPrice, C, Overline, Sea } from "./board";

const BOARD = 1040;
/** The face's inner width: the board less the frame (2 × 16) and the face's side padding (2 × 40). */
const TEXT = BOARD - 32 - 80;
/** Average character widths (in em) the fitting assumes: Lilita One, and Barlow 600. */
const LILITA_EM = 0.52;
const BARLOW_EM = 0.5;
/** The overline: Barlow 600 capitals tracked 0.1em. */
const OVERLINE_EM = 0.68;

/** Text cut to `lines` lines with an ellipsis (Satori: block display, overflow hidden, lineClamp). */
function Clamp({ children, lines, style }: { children: ReactNode; lines: number; style: Record<string, string | number> }) {
  return (
    <div style={{ display: "block", overflow: "hidden", lineClamp: lines, textAlign: "center", maxWidth: TEXT, ...style }}>
      {children}
    </div>
  );
}

/** The face's content height: what fits between the plaque and the life ring, clear of the wood strip. */
const CONTENT = 364;
/** The list card's content height (its board hangs a little higher, with less face padding). */
const LIST_CONTENT = 386;
/** Estimated line count at `size` for a face (`em`: its average character width). */
const linesAt = (text: string, size: number, em: number) => estimateLines(text, size, { width: TEXT, em });

/**
 * One line of `text` at the largest of `oneLine` that fits, else two lines at the largest of `twoLines`
 * (a longer text is clamped to two lines with an ellipsis).
 */
function fitLines(text: string, em: number, oneLine: readonly number[], twoLines: readonly number[]): { size: number; lines: number } {
  const one = oneLine.find((size) => linesAt(text, size, em) <= 1);
  if (one) return { size: one, lines: 1 };
  const size = fitFontSize(text, { width: TEXT, lines: 2, sizes: twoLines, em });
  return { size, lines: Math.min(2, linesAt(text, size, em)) };
}

function BoardCardImage({ card }: { card: BoardCard }) {
  const overlineLines = Math.min(2, linesAt(card.overline, 22, OVERLINE_EM));
  const title = fitLines(card.title, LILITA_EM, [76, 68, 60, 52], [60, 54, 48, 44]);
  const sub = card.sub ? fitLines(card.sub, BARLOW_EM, [34, 30, 27, 24], [26, 24]) : null;
  // The price takes what the name, burger and small print leave, up to the board's size.
  const used = overlineLines * 26.4 + 10 + title.lines * title.size * 1.02 + (sub ? 6 + sub.lines * sub.size * 1.15 : 0) + 6 + 8 + 29;
  const priceSize = Math.max(90, Math.min(sub ? 176 : 240, Math.floor((CONTENT - used) / 0.9)));
  // Room left over lengthens the ropes: a shorter board hangs lower, clear of the wood strip either way.
  const spare = Math.max(0, CONTENT - used - priceSize * 0.9);
  return (
    <Sea>
      <Board width={BOARD} marginTop={42} hang={30 + Math.round(spare / 2)} facePadding="26px 40px 30px">
        <Overline size={22}>{card.overline}</Overline>
        <Clamp lines={2} style={{ fontFamily: "Lilita One", fontSize: title.size, lineHeight: 1.02, marginTop: 10, color: C.signInk }}>
          {card.title}
        </Clamp>
        {card.sub && sub ? (
          <Clamp lines={2} style={{ fontSize: sub.size, fontWeight: 600, lineHeight: 1.15, marginTop: 6, color: C.signInk }}>
            {card.sub}
          </Clamp>
        ) : null}
        {card.price !== null ? (
          <BoardPrice value={card.price} size={priceSize} marginTop={6} />
        ) : (
          <div style={{ display: "flex", fontFamily: "Lilita One", fontSize: 110, lineHeight: 1, color: C.signPrice, marginTop: 6 }}>—</div>
        )}
        <BoardLine parts={card.line} size={24} marginTop={8} />
      </Board>
    </Sea>
  );
}

/**
 * A price with each digit in a box of one width: Satori sets no OpenType features, so Barlow's default
 * proportional figures are made tabular by hand (DESIGN.md "Numerals": a column of prices lines up).
 */
function TabularPrice({ value, size }: { value: number; size: number }) {
  const digit = Math.round(size * 0.56);
  return (
    <div style={{ display: "flex", alignItems: "baseline", fontSize: size, fontWeight: 700, color: C.signPrice }}>
      {[...formatPrice(value, { cents: "always" })].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} style={{ display: "flex", justifyContent: "center", width: digit }}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </div>
  );
}

function ListCardImage({ card }: { card: ListCard }) {
  const title = fitLines(card.title, LILITA_EM, [60, 54, 48], [56, 50, 44]);
  const rule = "2px solid rgba(58,31,12,0.22)";
  const used = 26.4 + 8 + title.lines * title.size * 1.04 + 12 + card.rows.length * 62 + (card.line ? 10 + 26.4 : 0);
  const spare = Math.max(0, LIST_CONTENT - used);
  // A list that isn't a ranking (a landmark page, nearest first) has no rank column.
  const ranked = card.rows.some((row) => row.rank !== null);
  return (
    <Sea>
      <Board width={BOARD} marginTop={40} hang={24 + Math.round(spare / 2)} facePadding="24px 40px 24px">
        <Overline size={22}>{card.overline}</Overline>
        <Clamp lines={2} style={{ fontFamily: "Lilita One", fontSize: title.size, lineHeight: 1.04, marginTop: 8, color: C.signInk }}>
          {card.title}
        </Clamp>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: 12, borderTop: rule }}>
          {card.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", height: 60, borderBottom: rule, gap: 18 }}>
              {ranked ? <div style={{ display: "flex", justifyContent: "flex-end", width: 40, fontSize: 28, fontWeight: 700 }}>{row.rank ?? ""}</div> : null}
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                <div style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 28, fontWeight: 600, lineHeight: 1.1 }}>{row.name}</div>
                {row.detail ? (
                  <div style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 19, fontWeight: 500, lineHeight: 1.2 }}>{row.detail}</div>
                ) : null}
              </div>
              {row.price !== null ? <TabularPrice value={row.price} size={30} /> : <div style={{ display: "flex", fontSize: 22, fontWeight: 600 }}>Not priced</div>}
            </div>
          ))}
        </div>
        {card.line ? <BoardLine parts={[card.line]} size={22} marginTop={10} /> : null}
      </Board>
    </Sea>
  );
}

/** The home card's rows: two columns of up to five (1-5, then 6-10), a rank in sign-painter red and a name. */
const TOP_ROW = 54;
const TOP_NAME = 36;

function TopCardImage({ card }: { card: TopCard }) {
  const rule = "2px solid rgba(58,31,12,0.22)";
  const perColumn = Math.min(5, Math.ceil(card.rows.length / 2));
  const columns = [card.rows.slice(0, perColumn), card.rows.slice(perColumn)].filter((c) => c.length);
  const used = 26.4 + 4 + 64 * 1.02 + 14 + perColumn * TOP_ROW;
  const spare = Math.max(0, LIST_CONTENT - used);
  return (
    <Sea>
      <Board width={BOARD} marginTop={40} hang={24 + Math.round(spare / 2)} facePadding="24px 40px 24px">
        <Overline size={22}>{card.overline}</Overline>
        <div style={{ display: "flex", fontFamily: "Lilita One", fontSize: 64, lineHeight: 1.02, marginTop: 4, color: C.signInk }}>{card.title}</div>
        <div style={{ display: "flex", width: "100%", marginTop: 14, gap: 44 }}>
          {columns.map((column, c) => (
            <div key={c} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, borderTop: rule }}>
              {column.map((row) => (
                <div key={row.rank} style={{ display: "flex", alignItems: "center", height: TOP_ROW, borderBottom: rule, gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", width: 52, fontFamily: "Lilita One", fontSize: 40, lineHeight: 1, color: C.signPrice }}>{row.rank}</div>
                  <div
                    style={{
                      display: "block",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      flexGrow: 1,
                      flexShrink: 1,
                      minWidth: 0,
                      fontSize: TOP_NAME,
                      fontWeight: 600,
                      lineHeight: 1.1,
                    }}
                  >
                    {row.name}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Board>
    </Sea>
  );
}

export function ShareCardImage({ card }: { card: ShareCard }) {
  if (card.kind === "top") return <TopCardImage card={card} />;
  return card.kind === "board" ? <BoardCardImage card={card} /> : <ListCardImage card={card} />;
}
