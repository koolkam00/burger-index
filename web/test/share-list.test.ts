// "Share your top 10" (lib/share-list.ts; user decision 2026-09-27): the image's rows (the list's first 10, numbered),
// its words, the link (the home ranker, no list data), the file name and alt text, names cut to fit with an ellipsis,
// and the layout's geometry (everything on the canvas, the rows on the sign, the call to action clear of the board).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitText,
  formatLabel,
  rankerShareUrl,
  SHARE_FORMATS,
  SHARE_GONE,
  SHARE_SIZES,
  SHARE_TOP,
  shareAlt,
  shareCta,
  sharedText,
  shareFileName,
  shareHost,
  shareLayout,
  shareRows,
  shareText,
  shareTitle,
  type ShareBurger,
} from "../src/lib/share-list";

const SITE = "https://nycburgerindex.vercel.app";
const URL_ = rankerShareUrl(SITE);
const burgers = new Map<string, ShareBurger>(
  Array.from({ length: 25 }, (_, i) => [`spot-${i + 1}`, { name: `Spot ${i + 1}`, burger: `Burger ${i + 1}`, where: i % 2 ? "Astoria, Queens" : "3 locations" }]),
);
const list = (n: number) => Array.from({ length: n }, (_, i) => `spot-${i + 1}`);

test("the image shows the list's first 10, best first, numbered from 1", () => {
  const rows = shareRows(list(25), (k) => burgers.get(k));
  assert.equal(SHARE_TOP, 10);
  assert.equal(rows.length, 10);
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(rows[0], { rank: 1, name: "Spot 1", detail: "Burger 1 · 3 locations" });
  assert.deepEqual(rows[9], { rank: 10, name: "Spot 10", detail: "Burger 10 · Astoria, Queens" });
  assert.equal(shareRows(list(4), (k) => burgers.get(k)).length, 4);
  // A burger that left the Burger Index keeps its place; its row says so.
  const gone = shareRows(["spot-1", "gone", "spot-3"], (k) => burgers.get(k));
  assert.deepEqual(gone[1], { rank: 2, name: SHARE_GONE, detail: "" });
  assert.equal(gone[2].rank, 3);
});

test("the words: the title, the call to action, the share text, the file name and the alt text", () => {
  assert.equal(shareTitle(3), "My top 3 burgers");
  assert.equal(shareTitle(10), "My top 10 burgers");
  assert.equal(shareTitle(25), "My top 10 burgers");
  assert.deepEqual(shareCta(URL_), { lead: "Rank yours at", host: "nycburgerindex.vercel.app" });
  assert.equal(shareText(4, URL_), "My top 4 burgers on The Burger Index. Rank yours: https://nycburgerindex.vercel.app/?ref=share#rank");
  assert.equal(shareFileName(25, "story"), "my-top-10-burgers-story.png");
  assert.equal(shareFileName(4, "square"), "my-top-4-burgers-square.png");
  assert.equal(formatLabel("story"), "Story · 1080 × 1920");
  assert.equal(formatLabel("square"), "Square · 1080 × 1080");
  assert.equal(sharedText("share"), "Shared.");
  assert.equal(sharedText("download", "my-top-4-burgers-story.png"), "Downloading my-top-4-burgers-story.png.");
  assert.equal(sharedText("copy_link"), "Link copied.");
  const rows = shareRows(list(3), (k) => burgers.get(k));
  assert.equal(
    shareAlt(rows, URL_),
    "The Burger Index: “My top 3 burgers” on a yellow order board hanging over the water: 1. Spot 1, Burger 1 · 3 locations; 2. Spot 2, Burger 2 · Astoria, Queens; 3. Spot 3, Burger 3 · 3 locations; then “Rank yours at nycburgerindex.vercel.app”.",
  );
});

test("the link is the home ranker's, with no list and no voter id", () => {
  assert.equal(URL_, "https://nycburgerindex.vercel.app/?ref=share#rank");
  assert.equal(rankerShareUrl(`${SITE}/`), URL_);
  assert.equal(rankerShareUrl("http://localhost:4173"), "http://localhost:4173/?ref=share#rank");
  assert.equal(shareHost("http://localhost:4173/?ref=share#rank"), "localhost:4173");
  const u = new URL(URL_);
  assert.deepEqual([...u.searchParams.keys()], ["ref"]);
  assert.equal(u.pathname, "/");
  assert.equal(u.hash, "#rank");
  for (const n of [3, 10, 25]) assert.doesNotMatch(shareText(n, URL_), /spot-|voter|[0-9a-f]{8}-[0-9a-f]{4}-/);
});

/** A stand-in for canvas measureText: 10 units a character (a surrogate pair is one). */
const measure = (s: string) => [...s].length * 10;

test("long names are cut to fit, with an ellipsis; names that fit are left alone", () => {
  assert.equal(fitText("Emily", 100, measure), "Emily");
  assert.equal(fitText("  Emily  ", 50, measure), "Emily");
  const long = "The Very Long Name of a Restaurant That Never Ends";
  const cut = fitText(long, 200, measure);
  assert.ok(cut.endsWith("…"), cut);
  assert.ok(measure(cut) <= 200, cut);
  assert.ok(long.startsWith(cut.slice(0, -1)), cut);
  assert.equal(cut, "The Very Long Name…");
  // The separator and spaces before the ellipsis go ("Burger ·…" reads as a broken line).
  assert.equal(fitText("Emily Burger · Clinton Hill, Brooklyn", 150, measure), "Emily Burger…");
  assert.equal(fitText("Sungold / Water Tower Bar", 110, measure), "Sungold…");
  // Never splits a surrogate pair.
  assert.equal(fitText("🍔🍔🍔🍔🍔🍔", 40, measure), "🍔🍔🍔…");
  // Too narrow for anything but the ellipsis.
  assert.equal(fitText("Emily", 5, measure), "…");
});

test("the layout: both sizes, 1 to 10 rows, everything on the canvas and nothing overlapping", () => {
  for (const format of SHARE_FORMATS) {
    const { width, height } = SHARE_SIZES[format];
    for (let n = 1; n <= 10; n++) {
      const L = shareLayout(format, n);
      const at = `${format} × ${n}`;
      assert.equal(L.width, width, at);
      assert.equal(L.height, height, at);
      assert.equal(L.rows.count, n, at);
      // The beam hangs under the awning; the sign under the beam, on its ropes.
      assert.ok(L.beam.y >= L.awning.height, at);
      assert.ok(L.frame.y >= L.beam.y + L.beam.height, at);
      assert.ok(L.ropes.top < L.frame.y && L.ropes.bottom >= L.frame.y, at);
      // The plaque sits on the frame's top edge, above the overline.
      assert.ok(L.plaque.cy + L.plaque.h / 2 < L.overline.y - L.overline.size / 2, at);
      // The rows fit on the face, under the title.
      assert.ok(L.rows.top > L.title.y + L.title.size / 2, at);
      assert.ok(L.rows.top + n * L.rows.height <= L.face.y + L.face.height, at);
      assert.ok(L.rows.textX < L.rows.textRight && L.rows.textRight <= L.face.x + L.face.width, at);
      // In a row, the restaurant's line sits above the burger's, both inside the row's rules.
      assert.ok(L.rows.nameY - (L.rows.name * 1.1) / 2 >= 2, at);
      assert.ok(L.rows.nameY + (L.rows.name * 1.1) / 2 <= L.rows.detailY - (L.rows.detail * 1.2) / 2 + 0.001, at);
      assert.ok(L.rows.detailY + (L.rows.detail * 1.2) / 2 <= L.rows.height - 2, at);
      // The board is on the canvas, the life ring too; the call to action and the strip are below it.
      assert.ok(L.frame.x >= 0 && L.frame.x + L.frame.width <= width, at);
      assert.ok(L.ring.cx - L.ring.size / 2 >= 0, at);
      const boardBottom = Math.max(L.frame.y + L.frame.height, L.ring.cy + L.ring.size / 2);
      if (L.cta.onStrip) assert.ok(boardBottom <= L.strip.y, at);
      else {
        assert.ok(boardBottom <= L.cta.y - L.cta.lead / 2, at);
        assert.ok(L.cta.hostY + L.cta.host / 2 <= L.strip.y, at);
      }
      assert.equal(L.strip.y + L.strip.height, height, at);
    }
    // More than 10 rows is 10.
    assert.equal(shareLayout(format, 25).rows.count, 10);
  }
});

test("a shorter list gets bigger rows, never more room than 10 rows", () => {
  for (const format of SHARE_FORMATS) {
    const ten = shareLayout(format, 10).rows;
    const three = shareLayout(format, 3).rows;
    assert.ok(three.height > ten.height && three.name > ten.name, format);
    for (let n = 1; n <= 10; n++) assert.ok(shareLayout(format, n).rows.height * n <= ten.height * 10 + 0.001, `${format} × ${n}`);
  }
  assert.equal(shareLayout("story", 3).rows.height, 104 * 1.4);
  assert.equal(shareLayout("square", 9).rows.height, 62 * (10 / 9));
});

test("the life ring stays clear of the last row", () => {
  for (const format of SHARE_FORMATS) for (let n = 1; n <= 10; n++) {
    const L = shareLayout(format, n);
    const r = L.ring.size / 2;
    const lastBottom = L.rows.top + n * L.rows.height;
    const rowsLeft = L.face.x + (L.face.x + L.face.width - L.rows.textRight);
    // Where the ring's circle is at the last row's bottom edge, it ends left of the rows.
    const dy = L.ring.cy - lastBottom;
    const reach = dy >= r ? -Infinity : L.ring.cx + Math.sqrt(r * r - dy * dy);
    assert.ok(reach < rowsLeft, `${format} × ${n}: the ring reaches ${reach}, the rows start at ${rowsLeft}`);
  }
});
