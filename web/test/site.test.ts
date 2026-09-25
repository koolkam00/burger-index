// SITE_URL resolution, page titles and robots.txt rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteUrl, fullTitle, pageMetadata } from "../src/lib/metadata";
import { AI_CRAWLERS, robotsConfig } from "../src/lib/robots";
import { LOCAL_SITE_URL, resolveSiteUrl, siteUrlWarning } from "../src/lib/site-url";

test("resolveSiteUrl: NEXT_PUBLIC_SITE_URL, then Vercel's production host, then the local preview", () => {
  assert.deepEqual(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://burgers.example/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }), {
    url: "https://burgers.example",
    source: "NEXT_PUBLIC_SITE_URL",
  });
  assert.deepEqual(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "burger-index-test.vercel.app" }), {
    url: "https://burger-index-test.vercel.app",
    source: "VERCEL_PROJECT_PRODUCTION_URL",
  });
  assert.deepEqual(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "" }), { url: LOCAL_SITE_URL, source: "local" });
  assert.deepEqual(resolveSiteUrl({}), { url: "http://localhost:4173", source: "local" });
  // A bare host gets https; an explicit http origin is kept (a local check); trailing slashes go.
  assert.equal(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "burgers.example" }).url, "https://burgers.example");
  assert.equal(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000//" }).url, "http://localhost:3000");
});

test("the local fallback is never a domain someone else owns, and it warns", () => {
  assert.ok(!resolveSiteUrl({}).url.includes("burgerindex.nyc"));
  assert.match(siteUrlWarning({}) ?? "", /NEXT_PUBLIC_SITE_URL.*VERCEL_PROJECT_PRODUCTION_URL.*localhost:4173/);
  assert.equal(siteUrlWarning({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }), null);
  assert.equal(siteUrlWarning({ NEXT_PUBLIC_SITE_URL: "https://burgers.example" }), null);
});

test("absoluteUrl: the home page is the bare origin (as Next writes the canonical), other paths appended", () => {
  assert.equal(absoluteUrl("/", "https://x.example"), "https://x.example");
  assert.equal(absoluteUrl("/burgers", "https://x.example"), "https://x.example/burgers");
  assert.equal(absoluteUrl("map", "https://x.example"), "https://x.example/map");
});

test("fullTitle: the brand suffix only when the whole title stays within 60 characters", () => {
  assert.equal(fullTitle("Burger prices in Queens: $18 median"), "Burger prices in Queens: $18 median · The Burger Index");
  const long = "Burger prices in Staten Island: $17 median";
  assert.equal(fullTitle(long), long);
  assert.equal(fullTitle("The Burger Index: NYC burger prices"), "The Burger Index: NYC burger prices");
  const meta = pageMetadata({ title: "Map", description: "d", path: "/map" });
  assert.deepEqual(meta.title, { absolute: "Map · The Burger Index" });
  assert.equal(meta.alternates?.canonical, "/map");
  assert.equal((meta.openGraph as { title?: string }).title, "Map · The Burger Index");
});

test("robots: every crawler allowed, AI search and training bots named, only /ingest/ disallowed", () => {
  const r = robotsConfig("https://burger-index-test.vercel.app");
  assert.equal(r.sitemap, "https://burger-index-test.vercel.app/sitemap.xml");
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  const star = rules.find((x) => x.userAgent === "*");
  assert.ok(star);
  assert.equal(star.allow, "/");
  assert.deepEqual(star.disallow, ["/ingest/"]);
  const named = rules.flatMap((x) => [x.userAgent ?? []].flat());
  for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended"]) {
    assert.ok(named.includes(bot), `${bot} is named`);
    assert.ok((AI_CRAWLERS as readonly string[]).includes(bot));
  }
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    assert.deepEqual([rule.disallow].flat(), ["/ingest/"], "a named bot reads only its own group, so it repeats the disallow");
  }
  assert.equal("host" in r, false);
});
