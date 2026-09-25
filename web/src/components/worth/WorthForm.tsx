"use client";

import { TriangleAlert } from "lucide-react";
import { useId, type ReactNode, type Ref } from "react";
import { OrderBell } from "@/components/icons/nautical";
import { ANSWER_MAX, ANSWER_MIN, formatDollars } from "@/lib/worth";
import { Dollars } from "./Dollars";

/**
 * The "What would you pay?" controls (DESIGN.md "WorthPicker"), shared by the restaurant page's picker
 * and the home pricer: a visible label, the big whole-dollar readout, the native range slider ($5 to
 * $75 in $1 steps: the browser's own keys), "$5" and "$75" under its ends, the "Order up!" ticket button
 * and the polite status line. Dragging never sends; the button (click, Enter or Space) calls `onOrder`.
 * `actions` go after the button (the pricer's Skip); `onRetry` puts a "Try again" after the status line.
 * `busy`: an answer is on its way, so the button is aria-disabled (it keeps focus) and does nothing.
 */
export function WorthForm({
  label,
  value,
  onValue,
  onOrder,
  enabled,
  canOrder,
  busy = false,
  status,
  alert,
  onRetry,
  actions,
  sliderRef,
}: {
  label: ReactNode;
  value: number;
  onValue: (dollars: number) => void;
  onOrder: () => void;
  enabled: boolean;
  canOrder: boolean;
  busy?: boolean;
  status: string;
  /** The status line is a failure: it gets the warning icon. */
  alert: boolean;
  onRetry?: (() => void) | null;
  actions?: ReactNode;
  sliderRef?: Ref<HTMLInputElement>;
}) {
  const uid = useId();
  const sliderId = `${uid}-slider`;
  const statusId = `${uid}-status`;
  return (
    <form
      className="worth-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canOrder && !busy) onOrder();
      }}
    >
      <label htmlFor={sliderId} className="t-ui-m worth-label">
        {label}
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
        onChange={(e) => onValue(Number(e.currentTarget.value))}
      />
      <div className="worth-scale t-num-s muted" aria-hidden="true">
        <span>{formatDollars(ANSWER_MIN)}</span>
        <span>{formatDollars(ANSWER_MAX)}</span>
      </div>
      <div className="worth-actions">
        <button type="submit" className="btn btn-primary btn-lg worth-order" disabled={!canOrder} aria-disabled={busy || undefined}>
          <OrderBell dings={false} />
          Order up!
        </button>
        {actions}
        <p id={statusId} className={`worth-status t-ui-s muted ${onRetry ? "is-retry" : ""}`} aria-live="polite">
          {alert ? <TriangleAlert className="worth-status-icon" strokeWidth={2} aria-hidden="true" /> : null}
          <span>{status}</span>
        </p>
        {onRetry ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </form>
  );
}
