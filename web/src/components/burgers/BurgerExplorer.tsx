"use client";

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BOROUGH_META, boroughBySlug, boroughInProse, type BoroughSlug } from "@/lib/boroughs";
import {
  activeFilterCount,
  EMPTY_FILTERS,
  MAX_QUERY,
  normalize,
  parseFilters,
  queryTokens,
  serializeFilters,
  SORTS,
  type ExplorerData,
  type Filters,
  type SortKey,
  type SourceKey,
} from "@/lib/explorer";
import { formatCount, formatPrice, pluralize } from "@/lib/format";
import { PRICE_SOURCE_LABEL, PROTEIN_LABEL } from "@/lib/labels";
import { binRanges } from "@/lib/price-bins";
import type { Borough, Protein } from "@/lib/schema";
import { useMediaQuery } from "../charts/hooks";
import { ShipWheel } from "../icons/nautical";
import { BoroughDot, EmptyState } from "../ui";
import { BurgerTable, type TableRow } from "./BurgerTable";
import { CheckList, FilterPopover, PriceInput } from "./controls";

const PAGE = 100;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

type Row = TableRow & { hay: string };

function sourceLabel(s: SourceKey) {
  return s === "unknown" ? "Unknown" : PRICE_SOURCE_LABEL[s];
}

function priceLabel(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${formatPrice(min, { cents: "always" })}–${formatPrice(max, { cents: "always" })}`;
  if (min !== null) return `${formatPrice(min, { cents: "always" })} and up`;
  return `Up to ${formatPrice(max, { cents: "always" })}`;
}

export function BurgerExplorer({ data }: { data: ExplorerData }) {
  const searchParams = useSearchParams();
  const neighborhoodSlugs = useMemo(() => new Set(data.neighborhoods.map((n) => n.slug)), [data.neighborhoods]);
  // The URL is the source of truth for filters; the search box keeps local state so typing stays
  // instant, and is written to the URL after a short pause.
  const urlFilters = useMemo(() => parseFilters(searchParams, neighborhoodSlugs), [searchParams, neighborhoodSlugs]);
  const [query, setQuery] = useState(urlFilters.q);
  // `written` is the q this explorer last put in the URL. When the URL's q changes to anything else
  // (a nav link to /burgers while the explorer stays mounted), the search box follows the URL.
  // Our own writes are skipped, so a trailing space the URL trims away is not taken back mid-typing.
  const [written, setWritten] = useState(urlFilters.q);
  const [seenQ, setSeenQ] = useState(urlFilters.q);
  if (urlFilters.q !== seenQ) {
    setSeenQ(urlFilters.q);
    if (urlFilters.q !== written) {
      setWritten(urlFilters.q);
      setQuery(urlFilters.q);
    }
  }
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const wide = useMediaQuery("(min-width: 640px)", true);
  const filters: Filters = useMemo(() => ({ ...urlFilters, q: query }), [urlFilters, query]);

  const commit = useCallback(
    (next: Filters) => {
      const qs = serializeFilters(next);
      setWritten(parseFilters(new URLSearchParams(qs), neighborhoodSlugs).q);
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
      setLimit(PAGE);
    },
    [neighborhoodSlugs],
  );
  const update = (patch: Partial<Filters>) => commit({ ...filters, ...patch });

  // Debounced write of the search box to the URL.
  useEffect(() => {
    if (query.trim() === urlFilters.q.trim()) return;
    const t = window.setTimeout(() => commit({ ...urlFilters, q: query }), 250);
    return () => window.clearTimeout(t);
  }, [query, urlFilters, commit]);

  // Arriving via /burgers#search focuses the search box.
  useEffect(() => {
    if (window.location.hash === "#search") inputRef.current?.focus();
  }, []);
  // "/" jumps back to the search box, but only while focus is inside the explorer (its filters, chips
  // or results), never page-wide: a single-character shortcut must not fire from anywhere on the page
  // (WCAG 2.1.4). Typing a "/" into a field still types it.
  const onExplorerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable='true'], dialog[open]")) return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  const rows: Row[] = useMemo(
    () =>
      data.burgers.map((b) => {
        const r = data.restaurants[b.r];
        return { b, r, hay: normalize(`${b.name} ${r.name} ${r.nb ?? ""} ${r.borough}`) };
      }),
    [data],
  );

  // Boroughs with at least one burger row: a borough with none gets "none yet" in the filter and its
  // own empty message, since no change of filters would bring rows back.
  const boroughsWithRows = useMemo(() => new Set<string>(rows.map(({ r }) => r.borough)), [rows]);

  const deferredQuery = useDeferredValue(query);
  const tokens = useMemo(() => queryTokens(deferredQuery), [deferredQuery]);

  const results = useMemo(() => {
    const bset = new Set<string>(urlFilters.boroughs);
    const pset = new Set<string>(urlFilters.proteins);
    const sset = new Set<string>(urlFilters.sources);
    const { min, max, neighborhood, indexOnly, sort, hideDelivery } = urlFilters;
    const out = rows.filter(({ b, r, hay }) => {
      if (bset.size && !bset.has(BOROUGH_META.find((m) => m.name === r.borough)!.slug)) return false;
      if (neighborhood && r.nbSlug !== neighborhood) return false;
      if (pset.size && !pset.has(b.protein)) return false;
      if (sset.size && !sset.has(r.source ?? "unknown")) return false;
      if (hideDelivery && r.source === "delivery_app") return false;
      if (indexOnly && !b.idx) return false;
      if (min !== null && (b.price === null || b.price < min)) return false;
      if (max !== null && (b.price === null || b.price > max)) return false;
      for (const t of tokens) if (!hay.includes(t)) return false;
      return true;
    });
    const byPrice = (a: Row, z: Row, dir: 1 | -1) => {
      if (a.b.price === null && z.b.price === null) return 0;
      if (a.b.price === null) return 1;
      if (z.b.price === null) return -1;
      return (a.b.price - z.b.price) * dir;
    };
    out.sort((a, z) => {
      switch (sort) {
        case "-price":
          return byPrice(a, z, -1) || collator.compare(a.b.name, z.b.name);
        case "name":
          return collator.compare(a.b.name, z.b.name) || byPrice(a, z, 1);
        case "restaurant":
          return collator.compare(a.r.name, z.r.name) || byPrice(a, z, 1);
        default:
          return byPrice(a, z, 1) || collator.compare(a.b.name, z.b.name);
      }
    });
    return out;
  }, [rows, tokens, urlFilters]);

  const shown = results.slice(0, limit);
  const nActive = activeFilterCount(filters);
  const bins = data.median !== null ? binRanges(data.median) : [];
  const neighborhoods = useMemo(() => {
    const allowed = new Set(filters.boroughs.map((s) => boroughBySlug(s)!.name));
    return data.neighborhoods
      .filter((n) => !allowed.size || allowed.has(n.borough))
      .sort((a, b) => BOROUGH_META.findIndex((m) => m.name === a.borough) - BOROUGH_META.findIndex((m) => m.name === b.borough) || collator.compare(a.name, b.name));
  }, [data.neighborhoods, filters.boroughs]);
  const selectedNeighborhood = data.neighborhoods.find((n) => n.slug === filters.neighborhood);

  // Hiding delivery-app prices is its own exclusion, not a rewrite of the Source list. Choosing it
  // drops "Delivery app" from that list, and ticking "Delivery app" there un-hides, so the two never
  // contradict each other.
  const setHideDelivery = (on: boolean) => update({ hideDelivery: on, sources: on ? filters.sources.filter((s) => s !== "delivery_app") : filters.sources });
  const setSources = (next: SourceKey[]) =>
    update({ sources: next.length >= data.sources.length ? [] : next, hideDelivery: filters.hideDelivery && !next.includes("delivery_app") });
  const clearAll = () => {
    setQuery("");
    commit({ ...EMPTY_FILTERS, sort: filters.sort });
  };

  // ---- filter groups (rendered in popovers on desktop, in the sheet on mobile) ----------------
  // In a popover (desktop) the groups are checkbox lists with the legend hidden (the chip names them);
  // in the mobile sheet they are wrapping buoy chips under a visible legend.
  const boroughGroup = (inSheet: boolean) => (
    <CheckList<BoroughSlug>
      legend="Borough"
      hideLegend={!inSheet}
      variant={inSheet ? "chips" : "list"}
      options={BOROUGH_META.map((m) => ({
        value: m.slug,
        label: (
          <span className="inline-flex items-center gap-2">
            <BoroughDot borough={m.name} />
            {m.name}
            {boroughsWithRows.has(m.name) ? null : <span className="t-ui-s muted">none yet</span>}
          </span>
        ),
      }))}
      selected={filters.boroughs}
      onChange={(next) => {
        const keepNb = selectedNeighborhood && (!next.length || next.some((s) => boroughBySlug(s)!.name === selectedNeighborhood.borough));
        update({ boroughs: next, neighborhood: keepNb ? filters.neighborhood : "" });
      }}
    />
  );
  const proteinGroup = (inSheet: boolean) => (
    <CheckList<Protein>
      legend="Protein"
      hideLegend={!inSheet}
      variant={inSheet ? "chips" : "list"}
      options={data.proteins.map((p) => ({ value: p, label: PROTEIN_LABEL[p] }))}
      selected={filters.proteins}
      onChange={(next) => update({ proteins: next })}
    />
  );
  const sourceGroup = (inSheet: boolean) => (
    <CheckList<SourceKey>
      legend="Price source"
      hideLegend={!inSheet}
      variant={inSheet ? "chips" : "list"}
      options={data.sources.map((s) => ({ value: s, label: sourceLabel(s) }))}
      selected={filters.sources}
      onChange={setSources}
    />
  );
  const priceGroup = (prefix: string) => (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <PriceInput id={`${uid}-${prefix}-min`} label="Min" value={filters.min} onCommit={(v) => update({ min: v })} />
        <PriceInput id={`${uid}-${prefix}-max`} label="Max" value={filters.max} onCommit={(v) => update({ max: v })} />
      </div>
      {bins.length ? (
        <fieldset>
          <legend className="t-label muted mb-2">Price level vs NYC median</legend>
          <ul className="grid gap-1">
            {bins.map((bin) => {
              const active = filters.min === bin.min && filters.max === bin.max;
              return (
                <li key={bin.key}>
                  <button
                    type="button"
                    aria-pressed={active}
                    className={`t-ui-s flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left ${active ? "bg-accent text-accent-ink" : "hover:bg-surface-2"}`}
                    onClick={() => update(active ? { min: null, max: null } : { min: bin.min, max: bin.max })}
                  >
                    <span className="swatch" style={{ background: bin.color }} aria-hidden="true" />
                    <span className="font-semibold">{bin.name}</span>
                    <span className={active ? "" : "muted"}>{bin.dollars}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
  const neighborhoodSelect = (className: string, id: string) => (
    <select
      id={id}
      className={className}
      value={filters.neighborhood}
      onChange={(e) => update({ neighborhood: e.target.value })}
      aria-label="Neighborhood"
    >
      <option value="">All neighborhoods</option>
      {BOROUGH_META.filter((m) => neighborhoods.some((n) => n.borough === m.name)).map((m) => (
        <optgroup key={m.slug} label={m.name}>
          {neighborhoods
            .filter((n) => n.borough === m.name)
            .map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
  const sortSelect = (id: string, className = "input w-auto") => (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="t-label muted whitespace-nowrap">
        Sort
      </label>
      <select id={id} className={className} value={filters.sort} onChange={(e) => update({ sort: e.target.value as SortKey })}>
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
  const toggles = (prefix: string) => (
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      <label className="t-ui-m flex min-h-11 cursor-pointer items-center gap-2">
        <input id={`${uid}-${prefix}-idx`} type="checkbox" className="checkbox" checked={filters.indexOnly} onChange={(e) => update({ indexOnly: e.target.checked })} />
        Index burgers only
      </label>
      {data.sources.includes("delivery_app") ? (
        <label className="t-ui-m flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" className="checkbox" checked={filters.hideDelivery} onChange={(e) => setHideDelivery(e.target.checked)} />
          Hide delivery-app prices
        </label>
      ) : null}
    </div>
  );

  // ---- active filter chips ------------------------------------------------------------------
  const chips: Array<{ key: string; label: string; borough?: Borough; clear: () => void }> = [
    ...filters.boroughs.map((s) => ({
      key: `b-${s}`,
      label: boroughBySlug(s)!.name,
      borough: boroughBySlug(s)!.name,
      clear: () => update({ boroughs: filters.boroughs.filter((x) => x !== s) }),
    })),
    ...(selectedNeighborhood ? [{ key: "nb", label: selectedNeighborhood.name, clear: () => update({ neighborhood: "" }) }] : []),
    ...(filters.min !== null || filters.max !== null ? [{ key: "price", label: priceLabel(filters.min, filters.max), clear: () => update({ min: null, max: null }) }] : []),
    ...filters.proteins.map((p) => ({ key: `p-${p}`, label: PROTEIN_LABEL[p], clear: () => update({ proteins: filters.proteins.filter((x) => x !== p) }) })),
    ...filters.sources.map((s) => ({ key: `s-${s}`, label: sourceLabel(s), clear: () => update({ sources: filters.sources.filter((x) => x !== s) }) })),
    ...(filters.hideDelivery ? [{ key: "no-delivery", label: "Delivery-app prices hidden", clear: () => update({ hideDelivery: false }) }] : []),
    ...(filters.indexOnly ? [{ key: "idx", label: "Index burgers only", clear: () => update({ indexOnly: false }) }] : []),
  ];

  const scope = [
    filters.boroughs.length ? filters.boroughs.map((s) => boroughInProse(boroughBySlug(s)!.name)).join(" or ") : null,
    selectedNeighborhood?.name ?? null,
  ]
    .filter(Boolean)
    .join(", ");
  const unpricedScope = filters.boroughs.length > 0 && filters.boroughs.every((s) => !boroughsWithRows.has(boroughBySlug(s)!.name));
  const emptyMessage = unpricedScope
    ? `We haven't priced any burgers in ${filters.boroughs.map((s) => boroughInProse(boroughBySlug(s)!.name)).join(" or ")} yet.`
    : query.trim()
      ? `No burgers match “${query.trim()}”${scope ? ` in ${scope}` : ""}. Nothing in the net; try fewer filters.`
      : `No burgers match these filters${scope ? ` in ${scope}` : ""}. Nothing in the net; try fewer filters.`;

  return (
    // The keydown listener only catches "/" (see onExplorerKey); the div itself is not focusable.
    <div onKeyDown={onExplorerKey}>
      {/* ---- Filter bar ---- */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-72">
            <label htmlFor="search" className="t-label muted mb-1.5 block">
              Search every burger
            </label>
            <div className="relative">
            <Search className="muted pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" strokeWidth={2} aria-hidden="true" />
            <input
              ref={inputRef}
              id="search"
              type="search"
              className={`input input-search pl-11 [&::-webkit-search-cancel-button]:hidden ${query ? "pr-12" : "pr-3 lg:pr-12"}`}
              placeholder={wide ? "Search burgers, restaurants, neighborhoods" : "Search burgers, restaurants"}
              maxLength={MAX_QUERY}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="icon-btn absolute top-1/2 right-1 size-9 -translate-y-1/2"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              <kbd className="t-num-s muted pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-[6px] border-[1.5px] border-line-strong px-1.5 py-0.5 lg:block" aria-hidden="true">
                /
              </kbd>
            )}
            </div>
          </div>
          <div className="hidden self-end md:block">{sortSelect(`${uid}-sort`)}</div>
        </div>

        {/* desktop filters */}
        <div className="hidden flex-wrap items-center gap-2 md:flex" role="group" aria-label="Filters">
          <FilterPopover label="Borough" count={filters.boroughs.length}>
            {boroughGroup(false)}
          </FilterPopover>
          {neighborhoodSelect(`chip max-w-[16rem] pr-2 ${filters.neighborhood ? "chip-active" : ""}`, `${uid}-d-nb`)}
          <FilterPopover label="Price" count={filters.min !== null || filters.max !== null ? 1 : 0}>
            <div className="w-72">{priceGroup("d")}</div>
          </FilterPopover>
          <FilterPopover label="Protein" count={filters.proteins.length}>
            {proteinGroup(false)}
          </FilterPopover>
          <FilterPopover label="Source" count={filters.sources.length}>
            {sourceGroup(false)}
          </FilterPopover>
          <div className="ml-2">{toggles("d")}</div>
        </div>

        {/* mobile: filters sheet + sort */}
        <div className="flex flex-wrap items-center gap-3 md:hidden">
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => sheetRef.current?.showModal()}>
            <ShipWheel aria-hidden="true" />
            Filters{nActive ? ` (${nActive})` : ""}
          </button>
          {sortSelect(`${uid}-msort`, "input w-auto max-w-[13rem]")}
        </div>

        {chips.length ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
            {chips.map((c) => (
              <button key={c.key} type="button" className="chip chip-active" onClick={c.clear}>
                {c.borough ? <BoroughDot borough={c.borough} /> : null}
                <span className="break-anywhere">{c.label}</span>
                <span className="sr-only">, remove filter</span>
                <X strokeWidth={2} aria-hidden="true" />
              </button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      <dialog
        ref={sheetRef}
        className="sheet sheet-bottom md:hidden"
        aria-labelledby={`${uid}-sheet-title`}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex max-h-[88dvh] flex-col">
          <span className="rope rope-flat flex-none" aria-hidden="true" />
          <div className="flex items-center justify-between border-b-2 border-line px-4 py-2">
            <div>
              <p className="kicker t-kicker">Your order</p>
              <h2 id={`${uid}-sheet-title`} className="t-display-s">
                Filters
              </h2>
            </div>
            <button type="button" className="icon-btn" aria-label="Close filters" onClick={() => sheetRef.current?.close()}>
              <X strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="grid flex-1 gap-6 overflow-y-auto px-4 py-4">
            {boroughGroup(true)}
            <div>
              <label htmlFor={`${uid}-m-nb`} className="t-label muted mb-1 block">
                Neighborhood
              </label>
              {neighborhoodSelect("input", `${uid}-m-nb`)}
            </div>
            <fieldset>
              <legend className="t-label muted mb-2">Price</legend>
              {priceGroup("m")}
            </fieldset>
            {proteinGroup(true)}
            {sourceGroup(true)}
            {toggles("m")}
          </div>
          <div className="flex items-center justify-between gap-3 border-t-2 border-line px-4 pt-3 pb-4">
            <button type="button" className="btn btn-ghost" onClick={clearAll}>
              Clear all
            </button>
            <button type="button" className="btn btn-primary" onClick={() => sheetRef.current?.close()}>
              Show {pluralize(results.length, "burger")}
            </button>
          </div>
        </div>
      </dialog>

      {/* ---- Results ---- */}
      <p className="t-ui-m muted mt-6 mb-3" aria-live="polite">
        {results.length ? `Showing ${formatCount(shown.length)} of ${pluralize(results.length, "burger")}` : "No burgers to show"}
        {results.length !== rows.length ? ` (filtered from ${formatCount(rows.length)})` : ""}
      </p>

      {results.length ? (
        <div className={deferredQuery !== query ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <BurgerTable rows={shown} median={data.median} tokens={tokens} sort={filters.sort} onSort={(s) => update({ sort: s })} />
          {results.length > shown.length ? (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button type="button" className="btn btn-secondary" onClick={() => setLimit((l) => l + PAGE)}>
                Haul in {formatCount(Math.min(PAGE, results.length - shown.length))} more
              </button>
              <span className="t-ui-s muted">
                Showing {formatCount(shown.length)} of {formatCount(results.length)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          height={240}
          art="net"
          action={
            nActive || query ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>
                Clear all filters
              </button>
            ) : null
          }
        >
          {emptyMessage}
        </EmptyState>
      )}
    </div>
  );
}
