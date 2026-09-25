"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Scales } from "@/components/icons/nautical";
import { BoroughDot, Money } from "@/components/ui";
import { track, worthAnsweredProps } from "@/lib/analytics";
import { BOROUGH_META, boroughBySlug, type BoroughSlug } from "@/lib/boroughs";
import { formatPrice, pluralize } from "@/lib/format";
import {
  ANYWHERE,
  answerGap,
  areaName,
  areaSlug,
  areaType,
  GAP_LABEL,
  inArea,
  type PricerArea,
  type PricerHood,
  type PricerPick,
} from "@/lib/pricer";
import { pricerStore, type PricerSnapshot } from "@/lib/pricer-store";
import { PRICER_ANCHOR, PRICER_FOCUS_EVENT, PRICER_TITLE_ID } from "@/lib/site";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { ANSWER_START, formatDollars, summarize, WORTH_ERROR_COPY, worthAnnouncement, worthStatusText } from "@/lib/worth";
import { canOrderUp, histKnown, worthStore } from "@/lib/worth-store";
import { Dollars } from "./Dollars";
import { useHists, useMyWorth } from "./hooks";
import { WorthForm } from "./WorthForm";

type FocusTarget = "heading" | "next";
type Hoods = ReadonlyMap<string, PricerHood>;

/** The last pick reported as pricer_exhausted (module-level: a remount after a navigation doesn't report it again). */
let exhaustedReported = 0;

function usePricer(): PricerSnapshot {
  return useSyncExternalStore(pricerStore.subscribe, pricerStore.getSnapshot, pricerStore.getServerSnapshot);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The burger pricer, the home page's first screen (DESIGN.md "The pricer hero"): pick an area, then
 * say what you'd pay for one burger at a time (the menu price hidden until the answer is saved), see
 * the menu price, your answer, the difference and the People's Price, and go on to the next burger.
 * Answers go through the worth store into the same People's Price pool as the restaurant pages.
 *
 * The prerendered page holds the area picker only (no prices: the burgers come from /data/pricer.json,
 * fetched when the pricer mounts). A returning visitor starts in their last area; until the pricer has
 * mounted, a <head> flag (html.pricer-saved) swaps the picker for a skeleton, so it never flashes. The
 * Supabase client loads when the pricer first needs it (a burger on the counter). Without the Supabase
 * settings the card says answers open soon. `boroughs` are those with a priced menu; `hoods` the
 * neighborhoods with one.
 */
export function Pricer({ hoods, boroughs }: { hoods: readonly PricerHood[]; boroughs: readonly BoroughSlug[] }) {
  const snap = usePricer();
  const mine = useMyWorth();
  const hists = useHists();
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  /** Answers sent from here, until saved: the location shown and its menu price (for worth_answered). */
  const sent = useRef(new Map<string, { restaurantId: string; price: number }>());
  const hoodMap = useMemo<Hoods>(() => new Map(hoods.map((h) => [h.slug, h])), [hoods]);

  // Mount: read this session and the saved area, and fetch the burgers.
  useEffect(() => {
    if (!WORTH_ENABLED) return;
    pricerStore.start(new Set(hoods.map((h) => h.slug)));
    void pricerStore.load();
  }, [hoods]);

  const playing = WORTH_ENABLED && snap.view === "play";
  // This browser's saved answers, once a burger is wanted (a browser that never answered makes no request).
  useEffect(() => {
    if (playing) void worthStore.loadMine();
  }, [playing]);

  // Never serve a burger this browser has priced: filter as my_worth arrives.
  useEffect(() => {
    pricerStore.setAnswered(mine.answers.keys());
  }, [mine.answers]);

  const key = snap.current?.menu.key ?? null;
  // The People's Price of the burger on the counter loads while the visitor thinks; it shows only after they answer.
  useEffect(() => {
    if (WORTH_ENABLED && key) void worthStore.loadHist([key]);
  }, [key]);

  // Each answer sent from here, once saved: counted for the session and reported.
  useEffect(
    () =>
      worthStore.onSaved(({ menuKey, dollars, previous }) => {
        const info = sent.current.get(menuKey);
        if (!info) return;
        sent.current.delete(menuKey);
        pricerStore.countAnswer();
        track("worth_answered", worthAnsweredProps({ menuKey, restaurantId: info.restaurantId, dollars, menuPrice: info.price, previous, surface: "home_pricer", priceHidden: true }));
      }),
    [],
  );

  // pricer_exhausted, once per pick that found nothing left.
  useEffect(() => {
    if (!snap.exhausted || !snap.area || exhaustedReported === snap.pick) return;
    exhaustedReported = snap.pick;
    track("pricer_exhausted", { area: areaSlug(snap.area) });
  }, [snap.exhausted, snap.area, snap.pick]);

  // After a step the visitor took, focus what it shows: the new heading, or "Next burger" after the
  // reveal. Only while focus is in the pricer (or was dropped with a control that went away).
  useEffect(() => {
    const want = pendingFocus.current;
    const root = rootRef.current;
    if (!want || !root) return;
    const el = root.querySelector<HTMLElement>(want === "next" ? "[data-pricer-next]" : "[data-pricer-heading]");
    if (!el) return;
    pendingFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    el.focus();
  });

  // The header's "Price a burger" on this page scrolls here and focuses the pricer; arriving on /#price
  // (from another page) focuses it too, once the router or the browser has scrolled.
  useEffect(() => {
    const focusPricer = (scroll: boolean) => {
      const root = rootRef.current;
      if (!root) return;
      if (scroll) document.getElementById(PRICER_ANCHOR)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      root.focus({ preventScroll: true });
    };
    const onCta = () => focusPricer(true);
    window.addEventListener(PRICER_FOCUS_EVENT, onCta);
    if (window.location.hash === `#${PRICER_ANCHOR}`) focusPricer(false);
    return () => window.removeEventListener(PRICER_FOCUS_EVENT, onCta);
  }, []);

  if (!WORTH_ENABLED) {
    return (
      <div className="pricer panel" data-nosnippet="">
        <PricerBar />
        <h3 className="t-display-m pricer-title">What would you pay for a burger?</h3>
        <p className="t-ui-m muted mt-2">{WORTH_ERROR_COPY.disabled}</p>
      </div>
    );
  }

  const choose = (a: PricerArea) => {
    track("pricer_area_selected", { area_type: areaType(a), area: areaSlug(a) });
    pendingFocus.current = "heading";
    pricerStore.choose(a);
    void pricerStore.load(); // again, if the first fetch failed
  };
  const changeArea = () => {
    pendingFocus.current = "heading";
    pricerStore.changeArea();
  };
  const skip = () => {
    if (key) track("pricer_skipped", { menu_key: key });
    pendingFocus.current = "heading";
    pricerStore.next();
  };
  const next = () => {
    track("pricer_next_clicked", { count_this_session: pricerStore.getSnapshot().answered });
    pendingFocus.current = "heading";
    pricerStore.next();
  };
  const order = (pick: PricerPick, dollars: number) => {
    sent.current.set(pick.menu.key, { restaurantId: pick.spot.id, price: pick.menu.price });
    pendingFocus.current = "next";
    pricerStore.send();
    worthStore.answer(pick.menu.key, dollars);
  };
  const retryLoad = () => {
    pendingFocus.current = "heading";
    void pricerStore.load();
  };

  const area = snap.area;
  const current = snap.current;
  // The reveal: "Order up!" pressed for this burger and its answer saved (not still on its way, not failed).
  const answer = key !== null ? (mine.answers.get(key) ?? null) : null;
  const revealed = snap.view === "play" && current !== null && snap.sent && key !== null && mine.saved.has(key) && !mine.saving.has(key) && !mine.errors.has(key) && answer !== null;
  // For screen readers: the reveal, once the People's Price is known (the facts aren't a live region).
  const announce =
    revealed && current && answer !== null && histKnown(hists, current.menu.key)
      ? `Menu price ${formatPrice(current.menu.price, { cents: "always" })}. Your answer ${formatDollars(answer)}. ${worthAnnouncement(summarize(hists.hists.get(current.menu.key), current.menu.price))}`.trim()
      : "";

  let body: ReactNode;
  if (snap.view === "choose") {
    body = <AreaPicker hoods={hoods} boroughs={boroughs} mounted={snap.restored} onChoose={choose} />;
  } else if (area === null) {
    body = null;
  } else if (snap.data === "error") {
    body = (
      <>
        <PricerBar area={area} hoods={hoodMap} onChangeArea={changeArea} />
        <p className="t-ui-m pricer-alert mt-4">
          <TriangleAlert className="worth-status-icon" strokeWidth={2} aria-hidden="true" />
          <span>Couldn&apos;t reach the counter. Check your connection and try again.</span>
        </p>
        <button type="button" className="btn btn-secondary mt-4" onClick={retryLoad}>
          Try again
        </button>
      </>
    );
  } else if (snap.exhausted) {
    body = <Exhausted area={area} hoods={hoodMap} onChangeArea={changeArea} onAnywhere={() => choose(ANYWHERE)} />;
  } else if (!current) {
    body = (
      <>
        <PricerBar area={area} hoods={hoodMap} onChangeArea={changeArea} />
        <CardSkeleton />
        <p className="sr-only" role="status">
          Loading burgers
        </p>
      </>
    );
  } else {
    body = (
      <>
        <PricerBar area={area} hoods={hoodMap} onChangeArea={changeArea} />
        <BurgerHead pick={current} hoods={hoodMap} />
        {revealed && answer !== null ? (
          <Reveal pick={current} answer={answer} onNext={next} />
        ) : (
          <BurgerForm key={snap.pick} pick={current} sent={snap.sent} onOrder={order} onSkip={skip} />
        )}
      </>
    );
  }

  // data-nosnippet: the slider's $40 start, its $5/$75 ends and the revealed prices are a game, not the page's prices.
  return (
    <div ref={rootRef} className="pricer panel" tabIndex={-1} data-nosnippet="" data-boot={snap.restored ? undefined : ""}>
      {body}
      {!snap.restored ? <BootSkeleton /> : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  );
}

/**
 * The card's top line: the section heading "What's it worth?" (a kicker-styled H2: it names the
 * pricer in every state) and, while pricing, the area (with "Change area" when `onChangeArea`).
 */
function PricerBar({ area, hoods, onChangeArea }: { area?: PricerArea; hoods?: Hoods; onChangeArea?: () => void }) {
  const borough = !area || area.kind === "nyc" ? null : area.kind === "borough" ? (boroughBySlug(area.slug)?.name ?? null) : (hoods?.get(area.slug)?.borough ?? null);
  return (
    <div className="pricer-bar">
      <h2 id={PRICER_TITLE_ID} className="kicker t-kicker">
        <Scales />
        What&apos;s it worth?
      </h2>
      {area && hoods ? (
        <p className="pricer-area t-ui-s">
          <span className="pricer-area-name">
            {borough ? <BoroughDot borough={borough} /> : null}
            <span className="break-anywhere font-semibold">{areaName(area, hoods)}</span>
          </span>
          {onChangeArea ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onChangeArea}>
              Change area
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Step 1: "Where are you eating?": anywhere, a borough (one tap each) or a neighborhood (a select and
 * "Go"). The neighborhood options wait for the pricer to mount (the select only works then), so the
 * prerendered page doesn't carry 120 neighborhood names above the board.
 */
function AreaPicker({
  hoods,
  boroughs,
  mounted,
  onChoose,
}: {
  hoods: readonly PricerHood[];
  boroughs: readonly BoroughSlug[];
  mounted: boolean;
  onChoose: (a: PricerArea) => void;
}) {
  const uid = useId();
  const [hood, setHood] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const groups = useMemo(
    () => BOROUGH_META.map((b) => ({ borough: b.name, list: hoods.filter((h) => h.borough === b.name) })).filter((g) => g.list.length > 0),
    [hoods],
  );
  const offered = BOROUGH_META.filter((b) => boroughs.includes(b.slug));
  return (
    <>
      <PricerBar />
      <div className="pricer-choose">
        <h3 tabIndex={-1} data-pricer-heading="" className="t-display-m pricer-title">
          Where are you eating?
        </h3>
        <p className="t-ui-m muted mt-1">Name your price, then see the menu price.</p>
        <button type="button" className="btn btn-primary btn-lg pricer-anywhere mt-4" onClick={() => onChoose(ANYWHERE)}>
          Anywhere in NYC
        </button>
        {offered.length ? (
          <div role="group" aria-labelledby={`${uid}-boroughs`} className="mt-5">
            <p id={`${uid}-boroughs`} className="t-label muted">
              Or a borough
            </p>
            <ul className="pricer-boroughs mt-2">
              {offered.map((b) => (
                <li key={b.slug}>
                  <button type="button" className="btn btn-secondary" onClick={() => onChoose({ kind: "borough", slug: b.slug })}>
                    <BoroughDot borough={b.name} />
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {groups.length ? (
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (hood) onChoose({ kind: "neighborhood", slug: hood });
              else selectRef.current?.focus();
            }}
          >
            <label htmlFor={`${uid}-hood`} className="t-label muted block">
              Or a neighborhood
            </label>
            <div className="pricer-hood mt-2">
              <select ref={selectRef} id={`${uid}-hood`} className="input" value={hood} onChange={(e) => setHood(e.currentTarget.value)}>
                <option value="">Pick a neighborhood</option>
                {(mounted ? groups : []).map((g) => (
                  <optgroup key={g.borough} label={g.borough}>
                    {g.list.map((h) => (
                      <option key={h.slug} value={h.slug}>
                        {h.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button type="submit" className="btn btn-secondary btn-lg">
                Go
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </>
  );
}

/** The burger on the counter: its name (big), where it is, and a short description. No price. */
function BurgerHead({ pick, hoods }: { pick: PricerPick; hoods: Hoods }) {
  const hood = pick.spot.hood ? hoods.get(pick.spot.hood) : undefined;
  const place = hood ? `${hood.name}, ${pick.spot.borough}` : pick.spot.borough;
  return (
    <div className="pricer-head">
      <h3 tabIndex={-1} data-pricer-heading="" className="t-display-m pricer-title break-anywhere">
        {pick.menu.burger}
      </h3>
      <p className="t-ui-m mt-1 break-anywhere">
        <span className="font-semibold">{pick.spot.name}</span>
        <span className="muted"> · {place}</span>
      </p>
      {pick.menu.description ? <p className="t-body-s muted prose-width mt-2">{pick.menu.description}</p> : null}
    </div>
  );
}

/**
 * Step 2: the slider (the restaurant page's, from $40), "Order up!" and "Skip". While the answer is on
 * its way the button is held (aria-disabled); a failure shows in the status line and can be sent again.
 * Keyed by the pick, so each burger starts at $40.
 */
function BurgerForm({ pick, sent, onOrder, onSkip }: { pick: PricerPick; sent: boolean; onOrder: (pick: PricerPick, dollars: number) => void; onSkip: () => void }) {
  const mine = useMyWorth();
  const [draft, setDraft] = useState<number | null>(null);
  const key = pick.menu.key;
  const value = draft ?? ANSWER_START;
  const saving = sent && mine.saving.has(key);
  const error = mine.errors.get(key) ?? null;
  const mineFailed = mine.status === "error";
  // As on a restaurant page: the untouched $40 goes out once this browser's saved answers are known.
  const canOrder = canOrderUp(mine.status, draft !== null);
  const status = worthStatusText({ enabled: true, error, saving, mineFailed, answer: null, dirty: false, justSaved: false });
  return (
    <div className="pricer-form">
      <WorthForm
        label="What would you pay?"
        value={value}
        onValue={(v) => {
          setDraft(v);
          pricerStore.hold();
        }}
        onOrder={() => onOrder(pick, value)}
        enabled
        canOrder={canOrder}
        busy={saving}
        status={status}
        alert={Boolean(error) || mineFailed}
        onRetry={mineFailed && !error && !saving ? () => void worthStore.loadMine() : null}
        actions={
          <button type="button" className="btn btn-secondary btn-lg" onClick={onSkip}>
            Skip
          </button>
        }
      />
    </div>
  );
}

/** One fact of the reveal: a label over a display value and an optional sub-line. */
function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pricer-fact">
      <dt className="t-label muted">{label}</dt>
      <dd className="t-stat mt-1">{value}</dd>
      {sub ? <dd className="t-ui-s muted mt-1">{sub}</dd> : null}
    </div>
  );
}

/**
 * Step 3, once the answer is saved (a data zone: flat): the menu price, the visitor's answer, the
 * difference and the People's Price with its answer count and verdict, then "Next burger" and the
 * restaurant's page.
 */
function Reveal({ pick, answer, onNext }: { pick: PricerPick; answer: number; onNext: () => void }) {
  const hists = useHists();
  const key = pick.menu.key;
  const known = histKnown(hists, key);
  const s = summarize(hists.hists.get(key), pick.menu.price);
  const gap = answerGap(answer, pick.menu.price);
  return (
    <div className="pricer-reveal">
      <dl className="pricer-facts">
        <Fact label="Menu price" value={<Money value={pick.menu.price} />} />
        <Fact label="Your answer" value={<Dollars value={answer} />} />
        <Fact label="Difference" value={gap.text} sub={GAP_LABEL[gap.side]} />
        <Fact
          label="People's Price"
          value={known ? s.people !== null ? <Dollars value={s.people} /> : "—" : <span className="skel inline-block h-8 w-16 align-middle" aria-hidden="true" />}
          sub={known ? pluralize(s.answers, "answer") : " "}
        />
      </dl>
      {known ? (
        <p className={`worth-verdict t-ui-m ${s.verdict.kind === "pending" ? "is-pending" : ""}`}>{s.verdict.label}</p>
      ) : hists.failed.has(key) ? (
        <p className="t-ui-m muted mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          Couldn&apos;t load the People&apos;s Price.
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void worthStore.loadHist([key])}>
            Try again
          </button>
        </p>
      ) : (
        <span className="sr-only" role="status">
          Loading the People&apos;s Price
        </span>
      )}
      <div className="pricer-next">
        <button type="button" className="btn btn-primary btn-lg" data-pricer-next="" onClick={onNext}>
          Next burger
          <ArrowRight strokeWidth={2} aria-hidden="true" />
        </button>
        <p className="t-ui-m break-anywhere">
          <span className="muted">Restaurant page:</span>{" "}
          <Link href={`/restaurants/${pick.spot.id}`} className="link">
            {pick.spot.name}
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The area has run out: say so and offer another area (or, citywide, the People's Price boards). */
function Exhausted({ area, hoods, onChangeArea, onAnywhere }: { area: PricerArea; hoods: Hoods; onChangeArea: () => void; onAnywhere: () => void }) {
  const citywide = area.kind === "nyc";
  return (
    <>
      {/* "Change area" is one of the two ways on below, so the bar only names the area. */}
      <PricerBar area={area} hoods={hoods} />
      <h3 tabIndex={-1} data-pricer-heading="" className="t-display-m pricer-title">
        No more burgers {inArea(area, hoods)}.
      </h3>
      <p className="t-ui-m muted mt-1">
        You&apos;ve priced or skipped every one.{citywide ? "" : " Try another area."}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {citywide ? (
          <Link href="/peoples-price" className="btn btn-primary btn-lg">
            See the People&apos;s Price
            <ArrowRight strokeWidth={2} aria-hidden="true" />
          </Link>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-lg" onClick={onAnywhere}>
              Anywhere in NYC
            </button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={onChangeArea}>
              Change area
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** Flat placeholders the shape of a burger card (no shimmer: nothing loops). */
function CardSkeleton() {
  return (
    <div className="pricer-skeleton" aria-hidden="true">
      <span className="skel h-8 w-3/4" />
      <span className="skel mt-3 h-4 w-1/2" />
      <span className="skel mt-6 h-12 w-24" />
      <span className="skel mt-3 h-3 w-full max-w-[560px]" />
      <span className="skel mt-6 h-12 w-44" />
    </div>
  );
}

/** Shown instead of the picker before the pricer mounts, when a saved area will take the visitor straight to a burger. */
function BootSkeleton() {
  return (
    <div className="pricer-boot" aria-hidden="true">
      <CardSkeleton />
    </div>
  );
}
