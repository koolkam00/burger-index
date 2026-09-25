"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { OrderBell } from "@/components/icons/nautical";
import { Money } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { ANSWER_MAX, ANSWER_MIN, ANSWER_START, formatDollars, summarize, WORTH_ERROR_COPY, worthAnnouncement } from "@/lib/worth";
import { canOrderUp, histKnown, worthStore } from "@/lib/worth-store";
import { AnswerSpread } from "./AnswerSpread";
import { Dollars } from "./Dollars";
import { useHists, useMyWorth } from "./hooks";

/** How often the People's Price refreshes while it is on screen and the tab is visible. */
const REFRESH_MS = 30_000;
/** When this browser's saved answers couldn't be loaded (the slider can't start at the saved one). */
const MINE_FAILED_COPY = "Couldn't load your saved answer.";

/**
 * "What would you pay?" (DESIGN.md "WorthPicker"): a native range slider, $5 to $75 in whole
 * dollars, with a big readout and an "Order up!" button that sends the answer (dragging never
 * sends). It starts at the visitor's saved answer, else the middle ($40), never at the menu price;
 * until the saved answer is known the untouched slider can't be sent (it would replace the saved
 * answer with $40). Once the visitor has answered, the People's Price, the menu price, their answer,
 * the answer count, the verdict and the answer distribution show below, refreshed every 30 s while
 * the tab is visible. Nothing is fetched (and the Supabase client isn't loaded) until the card comes
 * within a screen or so of the viewport. Without the Supabase settings the slider and button are
 * disabled and the card says answers open soon.
 */
export function WorthPicker({ menuKey, burger, price }: { menuKey: string; burger: string; price: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const mine = useMyWorth();
  const hists = useHists();
  const [draft, setDraft] = useState<number | null>(null);
  const uid = useId();
  const sliderId = `${uid}-slider`;
  const statusId = `${uid}-status`;
  const enabled = WORTH_ENABLED;

  useEffect(() => {
    if (!WORTH_ENABLED) return;
    const start = () => {
      void worthStore.loadMine();
      void worthStore.loadHist([menuKey]);
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

  const answer = mine.answers.get(menuKey) ?? null;
  // The slider shows what the visitor dragged to; before that, their saved answer, else the middle.
  const value = draft ?? answer ?? ANSWER_START;
  const saving = mine.saving.has(menuKey);
  const error = mine.errors.get(menuKey) ?? null;
  const justSaved = mine.saved.has(menuKey);
  const dirty = draft !== null && draft !== answer;
  // The untouched $40 only goes out once the saved answer is known (loaded, or none to load): sent
  // earlier it would replace a saved answer that hasn't arrived yet. A moved slider can always go.
  const canOrder = enabled && canOrderUp(mine.status, draft !== null);
  const mineFailed = enabled && mine.status === "error" && answer === null;
  const offerRetry = mineFailed && !error && !saving;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canOrder) return;
    worthStore.answer(menuKey, value);
    setDraft(value);
  }

  function retryMine() {
    // The button goes away once the load starts: keep focus on the card, on the slider it fills.
    sliderRef.current?.focus();
    void worthStore.loadMine();
  }

  const status = !enabled
    ? WORTH_ERROR_COPY.disabled
    : error
      ? WORTH_ERROR_COPY[error]
      : saving
        ? "Sending your answer…"
        : mineFailed
          ? MINE_FAILED_COPY
          : answer !== null
            ? dirty
              ? `Your answer: ${formatDollars(answer)}. Order up to change it.`
              : justSaved
                ? `Saved: ${formatDollars(answer)}.`
                : `Your answer: ${formatDollars(answer)}.`
            : "Slide to your price, then order up.";

  // For screen readers: once an answer is saved, what the crowd says (the results below aren't a live
  // region). Empty while an answer is on its way, so a second answer is announced again.
  const announce =
    enabled && justSaved && !saving && !error && answer !== null && histKnown(hists, menuKey)
      ? worthAnnouncement(summarize(hists.hists.get(menuKey), price))
      : "";

  return (
    <div ref={ref} className="worth-card panel">
      <form className="worth-form" onSubmit={onSubmit}>
        <label htmlFor={sliderId} className="t-ui-m worth-label">
          Your price for <span className="break-anywhere font-semibold">{burger}</span>
        </label>
        <p className="worth-readout" aria-hidden="true">
          <Dollars value={value} />
        </p>
        <input
          ref={sliderRef}
          id={sliderId}
          type="range"
          className="worth-range"
          min={ANSWER_MIN}
          max={ANSWER_MAX}
          step={1}
          value={value}
          aria-valuetext={formatDollars(value)}
          aria-describedby={statusId}
          disabled={!enabled}
          onChange={(e) => setDraft(Number(e.currentTarget.value))}
        />
        <div className="worth-scale t-num-s muted" aria-hidden="true">
          <span>{formatDollars(ANSWER_MIN)}</span>
          <span>{formatDollars(ANSWER_MAX)}</span>
        </div>
        <div className="worth-actions">
          <button type="submit" className="btn btn-primary btn-lg worth-order" disabled={!canOrder}>
            <OrderBell dings={false} />
            Order up!
          </button>
          <p id={statusId} className={`worth-status t-ui-s muted ${offerRetry ? "is-retry" : ""}`} aria-live="polite">
            {error || mineFailed ? <TriangleAlert className="worth-status-icon" strokeWidth={2} aria-hidden="true" /> : null}
            <span>{status}</span>
          </p>
          {offerRetry ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={retryMine}>
              Try again
            </button>
          ) : null}
        </div>
      </form>

      {enabled && answer !== null ? <Results menuKey={menuKey} price={price} answer={answer} /> : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  );
}

/**
 * What the crowd says, shown once the visitor has answered. A data zone: flat, no decoration. While it
 * is on screen, the menu's histogram is fetched again every 30 s (and when the visitor comes back to
 * the tab), so other visitors' answers show without a reload. A poll, not a realtime channel: every
 * restaurant page view would otherwise hold a connection.
 */
function Results({ menuKey, price, answer }: { menuKey: string; price: number; answer: number }) {
  const hists = useHists();
  const uid = useId();
  const known = histKnown(hists, menuKey);
  const s = summarize(hists.hists.get(menuKey), price);

  useEffect(() => {
    // Only once the first load has landed ("Try again" handles a failed one).
    if (!known) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void worthStore.loadHist([menuKey]);
    };
    const poll = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [known, menuKey]);

  if (!known) {
    return (
      <div className="worth-results">
        {hists.failed.has(menuKey) ? (
          <p className="t-ui-m muted flex flex-wrap items-center gap-x-4 gap-y-2">
            Couldn&apos;t load the People&apos;s Price.
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void worthStore.loadHist([menuKey])}>
              Try again
            </button>
          </p>
        ) : (
          <>
            <span className="skel block h-10 w-40" aria-hidden="true" />
            <span className="skel mt-3 block h-5 w-56" aria-hidden="true" />
            <span className="sr-only" role="status">
              Loading the People&apos;s Price
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="worth-results">
      <dl className="worth-facts">
        <div className="worth-fact worth-fact-main">
          <dt className="t-label muted">People&apos;s Price</dt>
          <dd className="t-stat mt-1">{s.people !== null ? <Dollars value={s.people} /> : "—"}</dd>
          <dd className="t-num-s muted mt-1">{pluralize(s.answers, "answer")}</dd>
        </div>
        <div className="worth-fact">
          <dt className="t-label muted">Menu price</dt>
          <dd className="t-stat mt-1">
            <Money value={price} />
          </dd>
        </div>
        <div className="worth-fact">
          <dt className="t-label muted">Your answer</dt>
          <dd className="t-stat mt-1">
            <Dollars value={answer} />
          </dd>
        </div>
      </dl>
      <p className={`worth-verdict t-ui-m ${s.verdict.kind === "pending" ? "is-pending" : ""}`}>{s.verdict.label}</p>
      <AnswerSpread id={`${uid}-spread`} hist={hists.hists.get(menuKey) ?? new Map()} price={price} mine={answer} />
      <p className="mt-5">
        <Link href="/peoples-price" className="link t-ui-m inline-flex items-center gap-1">
          See the People&apos;s Price board
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
