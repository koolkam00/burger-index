"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Filter button + popover panel. Escape or an outside click closes it; focus returns to the button. */
export function FilterPopover({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) {
      // Keep the panel inside the viewport (no horizontal page scroll).
      panel.style.left = "0";
      panel.style.right = "auto";
      if (panel.getBoundingClientRect().right > window.innerWidth - 8) {
        panel.style.left = "auto";
        panel.style.right = "0";
      }
      panel.querySelector<HTMLElement>("input, select, button")?.focus();
    }
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className={`chip ${count ? "chip-active" : ""}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {count ? <span className="t-num-s">({count})</span> : null}
        <ChevronDown strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        // tabIndex -1: a mousedown on anything inside that the browser won't focus (label text,
        // legends, and in Safari even checkboxes and buttons) moves focus to the nearest focusable
        // ancestor. Without this that ancestor is <main tabindex="-1">, the blur above sees focus
        // leave, and the panel closes before the click lands.
        <div ref={panelRef} id={id} className="popover outline-none" role="group" aria-label={label} tabIndex={-1}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A multi-select group. `list`: checkboxes in a column (the desktop popovers). `chips`: wrapping
 * "buoy" toggle chips (aria-pressed) that never scroll sideways (the mobile filter sheet).
 */
export function CheckList<T extends string>({
  legend,
  options,
  selected,
  onChange,
  hideLegend = false,
  variant = "list",
}: {
  legend: string;
  options: Array<{ value: T; label: ReactNode }>;
  selected: readonly T[];
  onChange: (next: T[]) => void;
  hideLegend?: boolean;
  variant?: "list" | "chips";
}) {
  const toggle = (value: T, on: boolean) => onChange(on ? [...selected, value] : selected.filter((v) => v !== value));
  return (
    <fieldset className="min-w-0">
      <legend className={hideLegend ? "sr-only" : `t-label muted ${variant === "chips" ? "mb-3" : "mb-1"}`}>{legend}</legend>
      {variant === "chips" ? (
        // Row gap 10px: the chips' 44px hit areas (on 34px pills) never overlap between rows.
        <ul className="flex flex-wrap gap-x-2 gap-y-2.5">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button type="button" className="chip" aria-pressed={on} onClick={() => toggle(o.value, !on)}>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul>
          {options.map((o) => (
            <li key={o.value}>
              <label className="t-ui-m flex min-h-11 cursor-pointer items-center gap-3 md:min-h-9">
                <input type="checkbox" className="checkbox" checked={selected.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
                <span className="min-w-0">{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Dollar input that commits on blur or Enter (so "12." can be typed). */
export function PriceInput({ id, label, value, onCommit }: { id: string; label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value === null ? "" : String(value));
  }
  const commit = () => {
    const t = text.trim().replace(/[$,\s]/g, "");
    const n = t === "" ? null : Number(t);
    const next = n !== null && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    if (next !== value) onCommit(next);
    else setText(value === null ? "" : String(value));
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="t-label muted block">
        {label}
      </label>
      <div className="relative mt-1">
        <span className="t-ui-l muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          className="input pl-7"
          inputMode="decimal"
          autoComplete="off"
          placeholder={label === "Min" ? "0" : "Any"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </div>
    </div>
  );
}
