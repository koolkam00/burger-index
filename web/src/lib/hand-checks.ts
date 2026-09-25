// Hand checks: prices a person re-read on the live menu after the scrape got them wrong
// (pipeline/corrections.py). The pipeline appends one sentence to the restaurant's status_detail:
//   "Prices corrected by hand after re-checking the menu on 2026-09-23: <reason>"
//   "Prices withheld after re-checking the menu on 2026-09-23: <reason>"
// The restaurant page shows only the kind and the day, as a label. Client-safe and pure.

export type HandCheck = {
  kind: "corrected" | "withheld";
  /** YYYY-MM-DD the menu was re-checked. */
  checkedOn: string;
};

const HAND_CHECK = /(?:^|\s)Prices (corrected by hand|withheld) after re-checking the menu on (\d{4}-\d{2}-\d{2}):\s*[\s\S]+$/;

/** The hand check recorded in a status_detail, or null when the prices were never corrected. */
export function parseHandCheck(statusDetail: string | null | undefined): HandCheck | null {
  if (!statusDetail) return null;
  const m = HAND_CHECK.exec(statusDetail);
  if (!m) return null;
  return { kind: m[1] === "withheld" ? "withheld" : "corrected", checkedOn: m[2] };
}
