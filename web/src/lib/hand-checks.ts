// Hand checks: prices a person re-read on the live menu after the scrape got them wrong
// (pipeline/corrections.py). The pipeline appends one sentence to the restaurant's status_detail:
//   "Prices corrected by hand after re-checking the menu on 2026-09-23: <reason>"
//   "Prices withheld after re-checking the menu on 2026-09-23: <reason>"
// Client-safe and pure.
import { menuKey } from "./menus";
import type { Restaurant } from "./schema";

export type HandCheck = {
  kind: "corrected" | "withheld";
  /** YYYY-MM-DD the menu was re-checked. */
  checkedOn: string;
  /** Why, in one or more sentences. */
  reason: string;
  /** The rest of status_detail (the scrape's own note), or null when there is none. */
  scrapeDetail: string | null;
};

const HAND_CHECK = /(?:^|\s)Prices (corrected by hand|withheld) after re-checking the menu on (\d{4}-\d{2}-\d{2}):\s*([\s\S]+)$/;

/** The hand check recorded in a status_detail, or null when the prices were never corrected. */
export function parseHandCheck(statusDetail: string | null | undefined): HandCheck | null {
  if (!statusDetail) return null;
  const m = HAND_CHECK.exec(statusDetail);
  if (!m) return null;
  const before = statusDetail.slice(0, m.index).trim();
  return {
    kind: m[1] === "withheld" ? "withheld" : "corrected",
    checkedOn: m[2],
    reason: m[3].trim(),
    scrapeDetail: before || null,
  };
}

export type HandCheckedMenu = { key: string; restaurant: Restaurant; check: HandCheck; locations: number };

/**
 * One entry per distinct menu with a hand check (a chain's correction covers every location, so it
 * is one entry), in first-seen order. Unpriced rows count too: withheld prices leave a menu unpriced.
 */
export function handCheckedMenus(list: readonly Restaurant[]): HandCheckedMenu[] {
  const byKey = new Map<string, HandCheckedMenu>();
  for (const r of list) {
    const check = parseHandCheck(r.status_detail);
    if (!check) continue;
    const k = menuKey(r);
    const seen = byKey.get(k);
    if (seen) seen.locations += 1;
    else byKey.set(k, { key: k, restaurant: r, check, locations: 1 });
  }
  return [...byKey.values()];
}
