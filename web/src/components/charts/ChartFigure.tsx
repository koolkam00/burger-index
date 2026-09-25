"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * DESIGN.md "Text alternative": every chart is a <figure> whose <figcaption> holds a title and a
 * one-sentence takeaway (the chart's SVG points at both with aria-labelledby), plus a
 * "View as table" toggle that swaps in a real <table> of the same numbers. The figure is a "menu
 * card" (thick soft border, block shadow); the plot inside stays flat --surface, with no ornament.
 */
export function ChartFigure({
  id,
  title,
  takeaway,
  chart,
  table,
}: {
  id: string;
  title: ReactNode;
  takeaway: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure aria-labelledby={`${id}-title`} className="chart-card">
      <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-[68ch]">
          <p id={`${id}-title`} className="t-ui-l font-bold">
            {title}
          </p>
          <p id={`${id}-desc`} className="t-ui-s muted mt-1">
            {takeaway}
          </p>
        </div>
        {/* The label says what the button does next ("View as chart" once the table shows), so it is a
            plain button: aria-pressed on a label that changes would read "View as chart, pressed". */}
        <button type="button" className="btn btn-ghost btn-sm -mx-3 no-print" onClick={() => setAsTable((v) => !v)}>
          {asTable ? <ChartColumn strokeWidth={2} aria-hidden="true" /> : <Table2 strokeWidth={2} aria-hidden="true" />}
          {asTable ? "View as chart" : "View as table"}
        </button>
      </figcaption>
      <div hidden={asTable}>{chart}</div>
      <div hidden={!asTable}>
        <div className="table-shell">{table}</div>
      </div>
    </figure>
  );
}
