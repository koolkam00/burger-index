"use client";

// "Share your top 10" (user decision 2026-09-27; DESIGN.md "The ranker hero", "Share your top 10"): under a saved list,
// a button that opens the share panel: the image size (a 1080×1920 story or a 1080×1080 square), a preview of the image
// (drawn in the browser, lib/share-list-image.ts), "Share image" where the browser can share files (the Web Share API),
// else "Download image", and "Copy link" with the link beside it. The link goes to the home ranker,
// https://<site>/?ref=share#rank: no list and no voter id. Each way of sharing says what it did in the status line and
// sends `list_shared` (method, length).
import { Download, Link as LinkIcon, Share2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { formatLabel, SHARE_FORMATS, SHARE_SIZES, shareAlt, sharedText, shareFileName, shareRows, shareText, shareTitle, type ShareBurger, type ShareFormat } from "@/lib/share-list";
import { renderShareImage } from "@/lib/share-list-image";

type Drawn = { src: string; file: File };
type Status = { text: string; alert?: boolean } | null;

/** Whether this browser can share an image file (the Web Share API with files: most phones, some desktops). */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71])], "top-10.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

export function ShareList({
  items,
  burgers,
  url,
  primary,
}: {
  /** The saved list, best first (the image shows its first 10). */
  items: readonly string[];
  burgers: ReadonlyMap<string, ShareBurger>;
  /** The link that goes with the image: the home ranker (lib/share-list rankerShareUrl). */
  url: string;
  /** The card's main action (a primary button), unless "Save again" is. */
  primary: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareFormat>("story");
  const [images, setImages] = useState<Partial<Record<ShareFormat, Drawn>>>({});
  const [failed, setFailed] = useState<Partial<Record<ShareFormat, boolean>>>({});
  const [canShare, setCanShare] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(new Set<ShareFormat>());
  const urls = useRef<string[]>([]);

  const length = items.length;
  const rows = shareRows(items, (key) => burgers.get(key));
  const image = images[format];

  // The previews' object URLs go when the panel does.
  useEffect(() => {
    const made = urls.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /** Draw the image in `f` (once; a failure can be tried again). */
  const draw = async (f: ShareFormat) => {
    if (images[f] || drawing.current.has(f)) return;
    drawing.current.add(f);
    setFailed((prev) => ({ ...prev, [f]: false }));
    try {
      const blob = await renderShareImage({ format: f, rows, length, url });
      const src = URL.createObjectURL(blob);
      urls.current.push(src);
      setImages((prev) => ({ ...prev, [f]: { src, file: new File([blob], shareFileName(length, f), { type: "image/png" }) } }));
    } catch {
      setFailed((prev) => ({ ...prev, [f]: true }));
    } finally {
      drawing.current.delete(f);
    }
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setStatus(null);
    setCanShare(canShareFiles());
    void draw(format);
  };
  const pick = (f: ShareFormat) => {
    setFormat(f);
    setStatus(null);
    void draw(f);
  };

  const share = async () => {
    if (!image) return;
    try {
      // Called straight from the click (the image is already drawn), so the browser counts it as the visitor's.
      await navigator.share({ files: [image.file], title: shareTitle(length), text: shareText(length, url) });
      setStatus({ text: sharedText("share") });
      track("list_shared", { method: "share", length });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // the visitor closed the share sheet
      setStatus({ text: "Couldn't open sharing here. Download the image instead.", alert: true });
    }
  };
  const download = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image.src;
    a.download = image.file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setStatus({ text: sharedText("download", image.file.name) });
    track("list_shared", { method: "download", length });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ text: sharedText("copy_link") });
      track("list_shared", { method: "copy_link", length });
    } catch {
      // No clipboard access: select the link for a copy by hand.
      linkRef.current?.focus();
      linkRef.current?.select();
      setStatus({ text: "Selected. Press Ctrl+C (⌘C on a Mac) to copy." });
    }
  };

  const panelId = `${uid}-panel`;
  const size = SHARE_SIZES[format];
  return (
    <div className="ranker-share">
      <button
        type="button"
        className={`btn btn-lg ${primary ? "btn-primary" : "btn-secondary"}`}
        aria-expanded={open}
        aria-controls={panelId}
        data-ranker-button="share"
        onClick={toggle}
      >
        <Share2 strokeWidth={2} aria-hidden="true" />
        Share your top 10
      </button>
      <div id={panelId} className="ranker-share-panel" hidden={!open}>
        {open ? (
          <>
            <fieldset className="share-sizes">
              <legend className="t-label muted">Image size</legend>
              <div className="share-size-row">
                {SHARE_FORMATS.map((f) => (
                  <label key={f} className="chip share-size">
                    <input type="radio" name={`${uid}-size`} value={f} checked={format === f} onChange={() => pick(f)} className="sr-only" />
                    {formatLabel(f)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={`share-preview is-${format}`}>
              {image ? (
                // A blob: URL drawn in this browser; next/image has nothing to optimize here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.src} alt={shareAlt(rows, url)} width={size.width} height={size.height} />
              ) : failed[format] ? (
                <div className="share-failed">
                  <p className="t-ui-m ranker-alert" role="alert">
                    <TriangleAlert className="status-icon" strokeWidth={2} aria-hidden="true" />
                    <span>Couldn&apos;t draw the image. Try again.</span>
                  </p>
                  <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => void draw(format)}>
                    Try again
                  </button>
                </div>
              ) : (
                <span className="skel share-skel" aria-hidden="true" />
              )}
            </div>
            <p className="sr-only" role="status">
              {image ? `Your image is ready: ${shareTitle(length)}, ${formatLabel(format)}.` : failed[format] ? "" : "Drawing your image…"}
            </p>
            <div className="ranker-actions mt-4">
              {canShare ? (
                <button type="button" className="btn btn-primary" aria-disabled={!image || undefined} onClick={() => void share()}>
                  <Share2 strokeWidth={2} aria-hidden="true" />
                  Share image
                </button>
              ) : null}
              <button type="button" className={`btn ${canShare ? "btn-secondary" : "btn-primary"}`} aria-disabled={!image || undefined} onClick={download}>
                <Download strokeWidth={2} aria-hidden="true" />
                Download image
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
                <LinkIcon strokeWidth={2} aria-hidden="true" />
                Copy link
              </button>
            </div>
            <label htmlFor={`${uid}-link`} className="t-label muted mt-4 mb-1.5 block">
              Link to share
            </label>
            <input ref={linkRef} id={`${uid}-link`} className="input share-link" readOnly value={url} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
            <p className="t-ui-s ranker-status mt-2" aria-live="polite">
              {status?.alert ? (
                <span className="ranker-alert">
                  <TriangleAlert className="status-icon" strokeWidth={2} aria-hidden="true" />
                  <span>{status.text}</span>
                </span>
              ) : (
                (status?.text ?? "")
              )}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
