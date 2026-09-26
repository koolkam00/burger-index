"use client";

// The People's Price of a few menus, read-only, for pages that list them (the most-recommended burgers):
// PeoplesPriceLoader loads the public histograms of the page's menus once (the worth store, one request
// for up to 100 menus), and each PeoplesPriceFact shows one menu's People's Price and answer count, "No
// answers yet" with a link to its slider, or nothing at all while answers are closed. Visitors' opinion,
// whole dollars (DESIGN.md "Money format"); nothing here says how it is computed.
import Link from "next/link";
import { useEffect } from "react";
import { pluralize } from "@/lib/format";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { histKnown, worthStore } from "@/lib/worth-store";
import { formatDollars, summarize, worthHref } from "@/lib/worth";
import { useHists } from "./hooks";

/** Loads the People's Price of `keys` (menu keys) once the page is up. Renders nothing. */
export function PeoplesPriceLoader({ keys }: { keys: readonly string[] }) {
  useEffect(() => {
    if (WORTH_ENABLED && keys.length) void worthStore.loadHist(keys);
  }, [keys]);
  return null;
}

/**
 * One menu's People's Price: "$31" over "14 answers"; "No answers yet" and "Name your price" (its slider)
 * when nobody has answered; a flat skeleton while loading; "Couldn't load" if the load failed. Nothing at
 * all while answers are closed (no Supabase settings).
 */
export function PeoplesPriceFact({ menuKey, menuPrice, restaurantId, labelId }: { menuKey: string; menuPrice: number; restaurantId: string; labelId: string }) {
  const hists = useHists();
  if (!WORTH_ENABLED) return null;
  const known = histKnown(hists, menuKey);
  const s = known ? summarize(hists.hists.get(menuKey), menuPrice) : null;
  return (
    <div className="min-w-0">
      <p id={labelId} className="t-label muted">
        People&apos;s Price
      </p>
      {!s ? (
        hists.failed.has(menuKey) ? (
          <p className="t-ui-s muted mt-1">Couldn&apos;t load</p>
        ) : (
          <span className="skel mt-1.5 block h-5 w-16" aria-hidden="true" />
        )
      ) : s.people === null ? (
        <p className="t-ui-s mt-1">
          <span className="muted">No answers yet · </span>
          <Link href={worthHref(restaurantId)} className="link" aria-describedby={labelId}>
            Name your price
          </Link>
        </p>
      ) : (
        <p className="mt-0.5">
          <span className="t-num-m">{formatDollars(s.people)}</span> <span className="t-num-s muted">{pluralize(s.answers, "answer")}</span>
        </p>
      )}
    </div>
  );
}
