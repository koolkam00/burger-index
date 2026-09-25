import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findKey, isLocalSite, MAX_URLS_PER_REQUEST, payloads, PUBLIC_DIR, resolveSite, sitemapUrls } from "../scripts/indexnow.mjs";

test("the committed key file: public/<key>.txt holds exactly its key", () => {
  const { key, file } = findKey(PUBLIC_DIR);
  assert.match(key, /^[a-zA-Z0-9-]{8,128}$/);
  assert.equal(file, `${key}.txt`);
  assert.equal(readFileSync(join(PUBLIC_DIR, file), "utf8").trim(), key);
});

test("findKey: exactly one key file, ignoring other .txt files", () => {
  const dir = mkdtempSync(join(tmpdir(), "indexnow-"));
  try {
    writeFileSync(join(dir, "notes.txt"), "hello");
    assert.throws(() => findKey(dir), /exactly one/);
    writeFileSync(join(dir, "abcdef0123456789.txt"), "abcdef0123456789\n");
    assert.deepEqual(findKey(dir), { key: "abcdef0123456789", file: "abcdef0123456789.txt" });
    writeFileSync(join(dir, "0123456789abcdef.txt"), "0123456789abcdef");
    assert.throws(() => findKey(dir), /found 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSite: --site, then SITE_URL, NEXT_PUBLIC_SITE_URL, Vercel's production host", () => {
  assert.equal(resolveSite({ SITE_URL: "https://a.example" }, "https://flag.example/"), "https://flag.example");
  assert.equal(resolveSite({ SITE_URL: "https://a.example/", NEXT_PUBLIC_SITE_URL: "https://b.example" }, undefined), "https://a.example");
  assert.equal(resolveSite({ NEXT_PUBLIC_SITE_URL: "https://b.example" }, undefined), "https://b.example");
  assert.equal(resolveSite({ VERCEL_PROJECT_PRODUCTION_URL: "burger-index.vercel.app" }, undefined), "https://burger-index.vercel.app");
  assert.equal(resolveSite({}, "burger-index.vercel.app"), "https://burger-index.vercel.app");
  assert.throws(() => resolveSite({}, undefined), /no site/);
  // A blank variable falls through, like site-url.ts.
  assert.equal(resolveSite({ SITE_URL: "", NEXT_PUBLIC_SITE_URL: "https://a.example/" }, undefined), "https://a.example");
  assert.equal(resolveSite({ SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "burger-index.vercel.app" }, undefined), "https://burger-index.vercel.app");
  assert.equal(resolveSite({ SITE_URL: "https://a.example" }, " "), "https://a.example");
  assert.throws(() => resolveSite({ SITE_URL: " ", VERCEL_PROJECT_PRODUCTION_URL: " " }, undefined), /no site/);
});

test("isLocalSite: IndexNow can't reach http, localhost or private addresses", () => {
  assert.equal(isLocalSite("http://localhost:4173"), true);
  assert.equal(isLocalSite("https://localhost"), true);
  assert.equal(isLocalSite("https://127.0.0.1:8443"), true);
  assert.equal(isLocalSite("http://burger-index.vercel.app"), true);
  assert.equal(isLocalSite("https://burger-index.vercel.app"), false);
});

test("sitemapUrls: every <loc>, entities decoded", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://x.example</loc></url><url>\n<loc> https://x.example/a?b=1&amp;c=2 </loc></url></urlset>`;
  assert.deepEqual(sitemapUrls(xml), ["https://x.example", "https://x.example/a?b=1&c=2"]);
});

test("payloads: host, key, keyLocation, URLs in batches of 10,000, all on the host", () => {
  const urls = Array.from({ length: MAX_URLS_PER_REQUEST + 5 }, (_, i) => `https://x.example/p/${i}`);
  const bodies = payloads({ site: "https://x.example", key: "abcdef0123456789", urls });
  assert.equal(bodies.length, 2);
  assert.deepEqual(Object.keys(bodies[0]), ["host", "key", "keyLocation", "urlList"]);
  assert.equal(bodies[0].host, "x.example");
  assert.equal(bodies[0].keyLocation, "https://x.example/abcdef0123456789.txt");
  assert.equal(bodies[0].urlList.length, MAX_URLS_PER_REQUEST);
  assert.equal(bodies[1].urlList.length, 5);
  assert.throws(() => payloads({ site: "https://x.example", key: "k".repeat(8), urls: ["https://other.example/a"] }), /not on x\.example/);
});
