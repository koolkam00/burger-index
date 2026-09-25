"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { pluralize } from "@/lib/format";
import { VOTING_ENABLED } from "@/lib/vote-config";
import { scoresKnown, voteStore } from "@/lib/vote-store";
import { formatAverage } from "@/lib/votes";
import { useScores } from "./hooks";
import { VotePicker } from "./VotePicker";

/**
 * The restaurant page's vote card (DESIGN.md "Restaurant vote card"): the visitors' average for this
 * menu's burger, then the picker. Nothing is fetched (and the Supabase client isn't loaded) until
 * the card comes within a screen or so of the viewport.
 */
export function RestaurantVote({ menuKey, burger, restaurant }: { menuKey: string; burger: string; restaurant: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scores = useScores();

  useEffect(() => {
    if (!VOTING_ENABLED) return;
    const start = () => {
      void voteStore.loadMine();
      void voteStore.loadScores([menuKey]);
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [menuKey]);

  const row = scores.rows.get(menuKey);
  const votes = row?.votes ?? 0;

  return (
    <div ref={ref} className="vote-card panel">
      <div className="vote-card-score">
        <p className="t-label muted">Visitor rating</p>
        {!VOTING_ENABLED ? (
          // The picker beside it says voting opens soon; no need to say it twice.
          <p className="t-stat muted mt-1" aria-hidden="true">
            —
          </p>
        ) : votes > 0 && row ? (
          <>
            <p className="mt-1">
              <span className="t-stat">{formatAverage(row.total / row.votes)}</span>
              <span className="t-ui-m muted"> out of 10</span>
            </p>
            <p className="t-num-s muted mt-1">{pluralize(votes, "vote")}</p>
          </>
        ) : !scoresKnown(scores, menuKey) && !scores.failed.has(menuKey) ? (
          <>
            <span className="skel mt-2 block h-10 w-24" aria-hidden="true" />
            <span className="sr-only" role="status">
              Loading the votes
            </span>
          </>
        ) : !scoresKnown(scores, menuKey) ? (
          <p className="t-ui-m muted mt-2">Couldn&apos;t load the votes.</p>
        ) : (
          <p className="t-ui-m mt-2">No votes yet — be the first.</p>
        )}
      </div>
      <div className="vote-card-pick">
        <VotePicker menuKey={menuKey} name={`${burger} at ${restaurant}`} />
        <p className="mt-3">
          <Link href="/best-burgers" className="link t-ui-m inline-flex items-center gap-1">
            See the best burgers
            <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </p>
      </div>
    </div>
  );
}
