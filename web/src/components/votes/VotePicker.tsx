"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { VOTING_ENABLED } from "@/lib/vote-config";
import { voteStore } from "@/lib/vote-store";
import { SCORE_MAX, SCORE_MIN, SCORES, VOTE_ERROR_COPY } from "@/lib/votes";
import { useMyVotes } from "./hooks";

/** How long a keyboard pick waits before it is sent, so arrowing across the row sends one vote. */
const KEYBOARD_PAUSE_MS = 700;

/**
 * The vote picker (DESIGN.md "Vote picker"): a row of ten order tickets, 1 to 10, as one radio
 * group. Arrow keys move and pick (wrapping), Home/End jump to 1/10; the checked ticket (else 1) is
 * the group's one tab stop. A pick shows at once and is saved in the background; a failure falls
 * back to the saved vote with a friendly message. Without the Supabase settings every ticket is
 * disabled and the picker says voting opens soon.
 *
 * `status`: "full" puts a message line under the tickets (restaurant page); "compact" puts a short
 * state beside the label and only shows a line underneath for errors (leaderboard rows).
 */
export function VotePicker({
  menuKey,
  name,
  label = "Your rating",
  size = "md",
  status = "full",
}: {
  menuKey: string;
  /** What is being rated, for the group's accessible name: "Fatso's Burger at 3 Sheets Saloon". */
  name: string;
  label?: string;
  size?: "md" | "sm";
  status?: "full" | "compact";
}) {
  const mine = useMyVotes();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = !VOTING_ENABLED;
  const picked = mine.picked.get(menuKey) ?? null;
  const saving = mine.saving.has(menuKey);
  const error = mine.errors.get(menuKey) ?? null;
  const justSaved = mine.saved.has(menuKey);
  const tabStop = picked ?? SCORE_MIN;

  // A keyboard pick still waiting out its pause is sent when the picker goes away.
  useEffect(() => () => voteStore.flush(menuKey), [menuKey]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, score: number) {
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = score >= SCORE_MAX ? SCORE_MIN : score + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = score <= SCORE_MIN ? SCORE_MAX : score - 1;
        break;
      case "Home":
        next = SCORE_MIN;
        break;
      case "End":
        next = SCORE_MAX;
        break;
      default:
        return;
    }
    e.preventDefault();
    refs.current[next - SCORE_MIN]?.focus();
    voteStore.vote(menuKey, next, KEYBOARD_PAUSE_MS);
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    // Focus left the row of tickets: send a pending keyboard pick now.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) voteStore.flush(menuKey);
  }

  const message = disabled
    ? "Voting opens soon."
    : error
      ? VOTE_ERROR_COPY[error]
      : saving
        ? "Saving your vote…"
        : picked !== null
          ? justSaved
            ? `Saved: ${picked} out of 10.`
            : `Your vote: ${picked} out of 10.`
          : "Tap a number to vote.";
  const short = disabled ? "Opens soon" : error ? "Not saved" : saving ? "Saving…" : justSaved && picked !== null ? "Saved" : "";

  return (
    <div className={`vote-picker ${size === "sm" ? "vote-picker-sm" : ""}`}>
      <div className="vote-picker-head">
        <span className="t-label muted">
          {label}
        </span>
        {status === "compact" ? (
          <span className="t-ui-s muted" aria-live="polite">
            {short}
          </span>
        ) : null}
      </div>
      <div role="radiogroup" aria-label={`${label}: ${name}`} className="vote-tickets" onBlur={onBlur}>
        {SCORES.map((s) => (
          <button
            key={s}
            ref={(el) => {
              refs.current[s - SCORE_MIN] = el;
            }}
            type="button"
            role="radio"
            className="vote-ticket"
            aria-checked={picked === s}
            aria-label={`Rate ${s} out of 10`}
            tabIndex={s === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => voteStore.vote(menuKey, s)}
            onKeyDown={(e) => onKeyDown(e, s)}
          >
            {s}
          </button>
        ))}
      </div>
      {status === "full" ? (
        <p className="vote-status t-ui-s muted" aria-live="polite">
          {error ? <TriangleAlert className="vote-status-icon" strokeWidth={2} aria-hidden="true" /> : null}
          <span>{message}</span>
        </p>
      ) : error ? (
        <p className="vote-status t-ui-s muted" role="alert">
          <TriangleAlert className="vote-status-icon" strokeWidth={2} aria-hidden="true" />
          <span>{VOTE_ERROR_COPY[error]}</span>
        </p>
      ) : null}
    </div>
  );
}
