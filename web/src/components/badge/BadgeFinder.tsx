"use client";

// The badge page's finder (DESIGN.md "Price badge"): the badge of the restaurant in `?r=<id>` (a restaurant
// page's "Get its price badge" link), else the example, then "Find your restaurant". The list of priced
// restaurants comes from the home pricer's static /data/pricer.json, fetched only when it is needed (a
// `?r=` other than the example, or a search), so the page's HTML carries one badge.
import { Search, TriangleAlert, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { badgeSpots, searchBadgeSpots, type BadgeSpot } from "@/lib/badge";
import { formatCount, pluralize } from "@/lib/format";
import { PRICER_DATA_PATH, type PricerData } from "@/lib/pricer";
import { BADGE_TITLE_ID, BadgePreview, type BadgeContext } from "./BadgePreview";

const MAX_HITS = 8;

type List = { spots: BadgeSpot[] } | { failed: true };

export function BadgeFinder({ example, context }: { example: BadgeSpot; context: BadgeContext }) {
  const fromUrl = useSearchParams().get("r");
  const [picked, setPicked] = useState<string | null>(null);
  const wanted = picked ?? fromUrl ?? example.id;
  const [query, setQuery] = useState("");
  const [list, setList] = useState<List | null>(null);
  const needList = wanted !== example.id || query.trim().length > 0;
  const uid = useId();

  useEffect(() => {
    if (!needList || (list && "spots" in list)) return;
    let alive = true;
    fetch(PRICER_DATA_PATH)
      .then((res) => (res.ok ? (res.json() as Promise<PricerData>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => alive && setList({ spots: badgeSpots(data) }))
      .catch(() => alive && setList({ failed: true }));
    return () => {
      alive = false;
    };
  }, [needList, list]);

  const spots = list && "spots" in list ? list.spots : null;
  const failed = list !== null && "failed" in list;
  const spot = wanted === example.id ? example : (spots?.find((s) => s.id === wanted) ?? null);
  const hits = useMemo(() => (spots ? searchBadgeSpots(spots, query) : []), [spots, query]);
  const searching = query.trim().length > 0;

  function pick(s: BadgeSpot) {
    setPicked(s.id);
    setQuery("");
    window.history.replaceState(window.history.state, "", `?r=${encodeURIComponent(s.id)}`);
    // Focus moves to the new badge's heading (the restaurant's name), so it is announced.
    requestAnimationFrame(() => document.getElementById(BADGE_TITLE_ID)?.focus());
  }

  return (
    <>
      <div>
        {spot ? (
          <BadgePreview spot={spot} context={context} example={!picked && !fromUrl} />
        ) : failed ? (
          <LoadFailed onRetry={() => setList(null)} />
        ) : spots ? (
          <div className="panel p-4 md:p-6">
            <p className="t-ui-m">We couldn&rsquo;t find that restaurant. Look it up below.</p>
          </div>
        ) : (
          <div className="panel p-4 md:p-6" aria-busy="true">
            <span className="sr-only">Finding your badge</span>
            <span className="skel block h-5 w-40" aria-hidden="true" />
            <span className="skel mt-4 block h-[84px] w-[300px] max-w-full" aria-hidden="true" />
            <span className="skel mt-6 block h-24 w-full" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="mt-8 max-w-xl">
        <label htmlFor={`${uid}-q`} className="t-label muted mb-1.5 block">
          Find your restaurant
        </label>
        <div className="relative">
          <Search className="muted pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" strokeWidth={2} aria-hidden="true" />
          <input
            id={`${uid}-q`}
            type="search"
            className="input input-search pr-12 pl-11 [&::-webkit-search-cancel-button]:hidden"
            placeholder="Restaurant name"
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button type="button" className="icon-btn absolute top-1/2 right-1 size-9 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery("")}>
              <X strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="t-ui-s muted mt-3" role="status">
          {searching && spots ? (hits.length ? `Showing ${formatCount(Math.min(MAX_HITS, hits.length))} of ${pluralize(hits.length, "match", "matches")}` : "") : ""}
        </p>
        {searching ? (
          failed ? (
            <LoadFailed onRetry={() => setList(null)} />
          ) : !spots ? (
            <p className="t-ui-s muted mt-2">Looking…</p>
          ) : hits.length ? (
            <ul className="mt-2">
              {hits.slice(0, MAX_HITS).map((s) => (
                <li key={s.id} className="border-b-[1.5px] border-line">
                  <button type="button" className="badge-hit ui-link" onClick={() => pick(s)}>
                    <span className="font-semibold break-anywhere">{s.name}</span>
                    <span className="t-ui-s muted block">{[s.hood ? context.hoods[s.hood] : null, s.borough].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-ui-m muted mt-2 ph-mask">
              No priced restaurant matches &ldquo;{query.trim()}&rdquo;. Only restaurants with a price here have a badge.
            </p>
          )
        ) : null}
      </div>
    </>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="panel p-4 md:p-6">
      <p className="t-ui-m flex items-start gap-2" role="alert">
        <TriangleAlert className="worth-status-icon mt-0.5 size-4 flex-none" strokeWidth={2} aria-hidden="true" />
        Couldn&rsquo;t reach the counter. Check your connection and try again.
      </p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
