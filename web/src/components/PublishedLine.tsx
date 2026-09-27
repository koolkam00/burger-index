// The People's Top 10's sourcing line (DESIGN.md; user decision 2026-09-26/27): one short line saying the published
// rankings count among the lists, each like one visitor's list, with each list linked by its month ("Aug 2026"). On
// /peoples-top-10 under the one-liner and in the ranker's People's Top 10 beside a list. No hooks: the page renders it
// on the server, the ranker in the browser. The words come from lib/published-lists.ts.
import { Fragment } from "react";
import type { PublishedLine as Line } from "@/lib/published-lists";

export function PublishedLine({ line, className = "" }: { line: Line; className?: string }) {
  const last = line.sources.length - 1;
  return (
    <p className={`ptop-sources ${className}`.trim()}>
      {line.lead}{" "}
      {line.sources.map((s, i) => (
        <Fragment key={s.publisher}>
          {i === 0 ? null : i === last ? " and " : ", "}
          {/* A publisher and its months wrap as one unit. */}
          <span className="whitespace-nowrap">
            {s.publisher} (
            {s.lists.map((l, j) => (
              <Fragment key={l.id}>
                {j ? ", " : null}
                {/* The month is the link's visible text; its accessible name adds the list's title. */}
                <a href={l.url} className="link" title={l.title}>
                  {l.when}
                  <span className="sr-only">{`: ${l.title}`}</span>
                </a>
              </Fragment>
            ))}
            )
          </span>
        </Fragment>
      ))}
      .
    </p>
  );
}
