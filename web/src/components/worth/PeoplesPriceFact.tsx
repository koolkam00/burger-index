"use client";

// The People's Price of a few menus, read-only, for pages that list them (the most-recommended burgers):
// PeoplesPriceLoader loads the public histograms of the page's menus once (the worth store, one request
// for up to 100 menus), and each PeoplesPriceFact shows one menu's People's Price and answer count, "No
// answers yet" with a link to its slider, or nothing at all while answers are closed. The page prerenders
// the daily snapshot's numbers (lib/peoples-price), so they are in the static HTML; the live ones replace
// them once loaded. Visitors' opinion, whole dollars (DESIGN.md "Money format"); nothing here says how it
// is computed.
import Link from "next/link";
import { useEffect } from "react";
import { formatDate, pluralize } from "@/lib/format";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { hasPeoplesPriceSentence, liveFigures, type PeoplesPriceFigures } from "@/lib/peoples-price";
import { histKnown, worthStore } from "@/lib/worth-store";
import { formatDollars, worthHref } from "@/lib/worth";
import { useHists } from "./hooks";

/** Loads the People's Price of `keys` (menu keys) once the page is up. Renders nothing. */
export function PeoplesPriceLoader({ keys }: { keys: readonly string[] }) {
  useEffect(() => {
    if (WORTH_ENABLED && keys.length) void worthStore.loadHist(keys);
  }, [keys]);
  return null;
}

/**
 * One menu's People's Price: "$31" over "14 answers"; "No answers yet" and "Name your price" (its slider) when
 * nobody has answered; "Couldn't load" if the load failed. Until the live numbers load it shows the snapshot's
 * (`snapshot`, prerendered: "$22" over "from 14 answers, as of Sep 25, 2026" with 3+ answers, the same wording
 * as live otherwise), or a flat skeleton without a snapshot. The answer link needs answers open (the Supabase
 * settings); without them only the snapshot's numbers show.
 */
export function PeoplesPriceFact({
  menuKey,
  restaurantId,
  labelId,
  snapshot,
}: {
  menuKey: string;
  restaurantId: string;
  labelId: string;
  snapshot: PeoplesPriceFigures | null;
}) {
  const hists = useHists();
  const f = WORTH_ENABLED && histKnown(hists, menuKey) ? liveFigures(hists.hists.get(menuKey)) : snapshot;
  if (!WORTH_ENABLED && (f === null || f.people === null)) return null;
  return (
    <div className="min-w-0">
      <p id={labelId} className="t-label muted">
        People&apos;s Price
      </p>
      {!f ? (
        hists.failed.has(menuKey) ? (
          <p className="t-ui-s muted mt-1">Couldn&apos;t load</p>
        ) : (
          <span className="skel mt-1.5 block h-5 w-16" aria-hidden="true" />
        )
      ) : f.people === null ? (
        <p className="t-ui-s mt-1">
          <span className="muted">No answers yet · </span>
          <Link href={worthHref(restaurantId)} className="link" aria-describedby={labelId}>
            Name your price
          </Link>
        </p>
      ) : hasPeoplesPriceSentence(f) && f.asOf ? (
        <>
          <p className="t-num-m mt-0.5">{formatDollars(f.people)}</p>
          <p className="t-ui-s muted">
            {`from ${pluralize(f.answers, "answer")}, as of `}
            <span className="whitespace-nowrap">{formatDate(f.asOf)}</span>
          </p>
        </>
      ) : (
        <p className="mt-0.5">
          <span className="t-num-m">{formatDollars(f.people)}</span> <span className="t-num-s muted">{pluralize(f.answers, "answer")}</span>
        </p>
      )}
    </div>
  );
}
