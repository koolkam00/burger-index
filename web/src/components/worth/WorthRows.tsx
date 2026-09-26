// The People's Price board's rows (DESIGN.md "The People's Price page": Row), presentational and server-safe:
// the live boards (PeoplesPriceBoard, a client component) and the static best-value list
// (/best-value-burgers) draw the same rows.
import Link from "next/link";
import { formatPrice, pluralize } from "@/lib/format";
import { formatDollars, worthHref, type WorthMenu, type WorthRow } from "@/lib/worth";

/** Column labels for sighted readers at desktop width; each row's cells carry their own words. */
export function WorthBoardHead({ ranked }: { ranked: boolean }) {
  return (
    <div className="worth-board-head t-label muted" aria-hidden="true">
      {ranked ? <span className="worth-rank">Rank</span> : null}
      <span className="worth-what">Burger</span>
      <span className="worth-cell wa-menu num">Menu</span>
      <span className="worth-cell wa-people num">People&apos;s</span>
      <span className="worth-cell wa-verdict">Verdict</span>
      <span className="worth-cell wa-count num">Answers</span>
    </div>
  );
}

/**
 * One row: rank, the restaurant (a link to its "What would you pay?" section) over "burger · where", then
 * Menu, People's, the verdict and the answer count. `onClick` (client boards only) follows the link.
 */
export function WorthRowView({ row: r, ranked, onClick }: { row: WorthRow<WorthMenu>; ranked: boolean; onClick?: () => void }) {
  const where = r.neighborhood ? `${r.neighborhood}, ${r.borough}` : r.locations > 1 ? pluralize(r.locations, "location") : r.borough;
  const verdict = r.answers === 0 ? "No answers yet" : r.verdict.label;
  return (
    <li className="worth-row" data-key={r.key} data-tally={`${r.answers}:${r.people ?? ""}`}>
      {ranked ? (
        <span className="worth-rank">
          <span className="sr-only">Rank </span>
          {r.rank ?? "–"}
        </span>
      ) : null}
      <div className="worth-what">
        <Link href={worthHref(r.id)} prefetch={false} className="ui-link t-ui-l break-anywhere font-semibold" onClick={onClick}>
          {r.name}
        </Link>
        <p className="t-ui-s muted break-anywhere">{[r.burger, where].join(" · ")}</p>
      </div>
      <div className="worth-facts-row">
        <p className="worth-cell wa-menu num">
          <span className="worth-k">Menu </span>
          <span className="t-num-m">{formatPrice(r.price, { cents: "always" })}</span>
        </p>
        <p className="worth-cell wa-people num">
          <span className="worth-k">People&apos;s </span>
          <span className="t-num-m">{r.people !== null ? formatDollars(r.people) : "—"}</span>
        </p>
        <p className={`worth-cell wa-verdict t-ui-s ${r.verdict.kind === "pending" ? "muted" : "font-semibold"}`}>{verdict}</p>
        <p className="worth-cell wa-count num t-num-s muted">{pluralize(r.answers, "answer")}</p>
      </div>
    </li>
  );
}
