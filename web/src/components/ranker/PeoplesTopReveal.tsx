"use client";

// The People's Top 10 beside the visitor's list (user decision 2026-09-26, "Once 3 are added"; DESIGN.md "The ranker
// hero", "The People's Top 10 beside your list"): a data zone inside the ranker card. The daily board's seats in
// order (the visitor's picks on it washed and marked "#2 on your list"), where the visitor's other picks stand, and a
// link to the whole board. The words and the marks come from lib/peoples-top-reveal (pure); this only draws them.
// Not a live region: the ranker's own live region says once that it appeared.
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { fromPath, track } from "@/lib/analytics";
import { FLAG_TEXT } from "@/lib/peoples-top";
import type { RevealView } from "@/lib/peoples-top-reveal";
import { PEOPLES_TOP_NAME, PEOPLES_TOP_PATH } from "@/lib/site";

export function PeoplesTopReveal({ view }: { view: RevealView }) {
  const uid = useId();
  return (
    <section className="ranker-reveal" aria-labelledby={`${uid}-title`} data-ranker-reveal="">
      <div className="ranker-reveal-head">
        <h3 id={`${uid}-title`} className="t-display-s">
          {PEOPLES_TOP_NAME}.
        </h3>
        {view.early ? <span className="badge ptop-early">Early results</span> : null}
      </div>
      {view.rows.length ? (
        <>
          <ol className="reveal-list mt-3" aria-labelledby={`${uid}-title`}>
            {view.rows.map((r) => (
              <li key={r.key} className={`reveal-row${r.yours !== null ? " is-yours" : ""}`}>
                <span className="reveal-rank">
                  {r.closeToAbove ? (
                    <span className="ptop-close" title="Too close to call with the burger above" aria-hidden="true">
                      ≈
                    </span>
                  ) : null}
                  <span className="sr-only">Number </span>
                  {r.rank}
                  {r.closeToAbove ? <span className="sr-only">, too close to call with number {r.rank - 1}</span> : null}
                </span>
                <div className="reveal-what">
                  <p className="font-semibold break-anywhere">{r.name}</p>
                  <p className="t-ui-s muted break-anywhere">{`${r.burger} · ${r.where}`}</p>
                  {r.flag || r.yours !== null ? (
                    <p className="reveal-tags t-ui-s">
                      {r.yours !== null ? (
                        <span className="reveal-yours">
                          <Check strokeWidth={2.5} aria-hidden="true" />
                          {`#${r.yours} on your list`}
                        </span>
                      ) : null}
                      {r.flag ? <span className="ptop-flag">{FLAG_TEXT[r.flag]}</span> : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="t-ui-s muted mt-2">{view.countLine}</p>
          {view.closeLegend ? (
            <p className="t-ui-s muted mt-1">
              <span aria-hidden="true">≈ </span>Too close to call with the burger above.
            </p>
          ) : null}
        </>
      ) : (
        <p className="reveal-empty t-ui-m mt-3">{view.empty}</p>
      )}
      {view.stands.length ? (
        <>
          <p id={`${uid}-stands`} className="t-label muted mt-5">
            {view.standsLabel}
          </p>
          <ul className="reveal-stands mt-2" aria-labelledby={`${uid}-stands`}>
            {view.stands.map((s) => (
              <li key={s.key} className="reveal-stand">
                <span className="font-semibold break-anywhere">{s.who}</span>
                <span className="sr-only">: </span>
                <span className="muted">{s.stand}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {view.rows.length ? (
        <p className="mt-4">
          <Link
            href={PEOPLES_TOP_PATH}
            className="link t-ui-m ranker-reveal-link"
            onClick={() => track("peoples_top_clicked", { surface: "ranker", from_path: fromPath(window.location.pathname) })}
          >
            See the full People&apos;s Top 10
            <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** Below 3 burgers, at `lg` only (where the People's Top 10 will sit): what shows it. Never the board itself. */
export function RevealHint() {
  return <p className="ranker-reveal-hint t-ui-m muted">Add 3 burgers to see the People&apos;s Top 10 beside your list.</p>;
}
