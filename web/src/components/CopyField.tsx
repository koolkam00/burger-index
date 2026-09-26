"use client";

// A snippet to copy (DESIGN.md "Copy field"): a label, the text in a read-only box (selected on focus, so
// it can always be copied by hand) and a "Copy" button. The badge page's HTML and image address and the
// press kit's credit line. Copying sends `snippet_copied` (lib/analytics; a no-op without the PostHog key).
import { Copy } from "lucide-react";
import { useRef, useState } from "react";
import { track, type AnalyticsEvents } from "@/lib/analytics";

export function CopyField({
  id,
  label,
  value,
  button,
  rows = 3,
  event,
}: {
  id: string;
  label: string;
  value: string;
  /** The button's words: "Copy HTML", "Copy the address", … */
  button: string;
  rows?: number;
  event?: AnalyticsEvents["snippet_copied"];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The status belongs to the value it was about: a new snippet starts with none.
  const [status, setStatus] = useState<{ value: string; ok: boolean } | null>(null);
  const shown = status && status.value === value ? status : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ value, ok: true });
      if (event) track("snippet_copied", event);
    } catch {
      // No clipboard access (an old browser, a denied permission): select it for a manual copy.
      ref.current?.focus();
      ref.current?.select();
      setStatus({ value, ok: false });
    }
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="t-label muted mb-1.5 block">
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="input copy-field"
        readOnly
        rows={rows}
        value={value}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
          <Copy strokeWidth={2} aria-hidden="true" />
          {button}
        </button>
        <span className="t-ui-s muted" aria-live="polite">
          {shown ? (shown.ok ? "Copied." : "Selected. Press Ctrl+C (⌘C on a Mac) to copy.") : ""}
        </span>
      </div>
    </div>
  );
}
