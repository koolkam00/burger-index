// web/vercel.json's redirects (the move to nycburgerindex.com, 2026-09-28). Vercel compiles a redirect's `source`
// with path-to-regexp in strict mode, where "/:path*" never matches "/": the old hosts' home (and every /?add= and
// /?ref=share link handed out before the move) stayed put. "/:path(.*)" matches the root too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (path: string, keys?: unknown[], options?: { strict?: boolean }) => RegExp;
};

type Redirect = { source: string; destination: string; permanent?: boolean; has?: { type: string; value: string }[] };
const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { redirects: Redirect[] };

const OLD_HOSTS = ["nycburgerindex.vercel.app", "burger-index-six.vercel.app"];
const hostRules = config.redirects.filter((r) => r.has?.some((h) => h.type === "host"));

/** Where Vercel sends `path` on a host rule: the source's capture put into the destination (the query is kept apart). */
function follow(rule: Redirect, path: string): string | null {
  const m = pathToRegexp(rule.source, [], { strict: true }).exec(path);
  return m ? rule.destination.replace(":path", m[1] ?? "") : null;
}

test("vercel.json: every old host 308s every path, the root included, to the same path on nycburgerindex.com", () => {
  assert.deepEqual(hostRules.map((r) => r.has?.[0].value).sort(), [...OLD_HOSTS].sort());
  for (const rule of hostRules) {
    assert.equal(rule.permanent, true, `${rule.has?.[0].value}: a permanent (308) redirect`);
    assert.equal(follow(rule, "/"), "https://nycburgerindex.com/", `${rule.has?.[0].value}: the home page redirects`);
    assert.equal(follow(rule, "/peoples-top-10"), "https://nycburgerindex.com/peoples-top-10");
    assert.equal(follow(rule, "/restaurants/3-sheets-saloon-west-village"), "https://nycburgerindex.com/restaurants/3-sheets-saloon-west-village");
    assert.equal(follow(rule, "/og.png"), "https://nycburgerindex.com/og.png");
  }
  // The old rule's shape, for the record: strict "/:path*" misses the root.
  assert.equal(pathToRegexp("/:path*", [], { strict: true }).test("/"), false);
});

test("vercel.json: the host redirects come first, then /peoples-price", () => {
  const i = config.redirects.findIndex((r) => r.source === "/peoples-price");
  assert.ok(i >= hostRules.length, "every old-host path leaves for nycburgerindex.com before any other redirect");
  assert.equal(config.redirects[i].destination, "/peoples-top-10");
});
