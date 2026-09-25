#!/usr/bin/env node
// Tell IndexNow (Bing, Yandex, Seznam, Naver and the other engines that share it) about every page in
// the live sitemap. Run it by hand after a production deploy (`npm run indexnow`); it is not part of
// the build.
//
//   npm run indexnow                          # SITE_URL, else NEXT_PUBLIC_SITE_URL, else https://$VERCEL_PROJECT_PRODUCTION_URL
//   npm run indexnow -- --site https://burger-index.vercel.app
//   npm run indexnow -- --dry-run             # check the key file and the sitemap, print what would be sent, send nothing
//   npm run indexnow -- --sitemap out/sitemap.xml   # read the URLs from a local build instead of the live sitemap
//
// The key is public by design: public/<key>.txt holds it and the export serves it at /<key>.txt,
// which is how IndexNow checks that the submitter controls the host. Before sending, the script
// checks that the live site serves that file and that every URL is on the site's host.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts up to 10,000 URLs per request. */
export const MAX_URLS_PER_REQUEST = 10_000;

const here = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = join(here, "..", "public");

/** The key file in public/: "<key>.txt" holding exactly "<key>" (IndexNow keys are 8–128 of [a-zA-Z0-9-]). */
export function findKey(dir = PUBLIC_DIR) {
  const found = readdirSync(dir)
    .map((f) => /^([a-zA-Z0-9-]{8,128})\.txt$/.exec(f))
    .filter((m) => m !== null)
    .filter((m) => readFileSync(join(dir, m[0]), "utf8").trim() === m[1])
    .map((m) => ({ key: m[1], file: m[0] }));
  if (found.length !== 1) {
    throw new Error(`expected exactly one IndexNow key file in ${dir} (<key>.txt containing the key), found ${found.length}`);
  }
  return found[0];
}

/**
 * The site origin: --site, else SITE_URL, NEXT_PUBLIC_SITE_URL, or https://$VERCEL_PROJECT_PRODUCTION_URL.
 * A blank value falls through to the next, as in src/lib/site-url.ts.
 */
export function resolveSite(env, flag) {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = ([flag, env.SITE_URL, env.NEXT_PUBLIC_SITE_URL].map((v) => v?.trim()).find(Boolean) ?? (vercel ? `https://${vercel}` : "")).replace(/\/+$/, "");
  if (!raw) throw new Error("no site: pass --site https://… or set SITE_URL (or NEXT_PUBLIC_SITE_URL / VERCEL_PROJECT_PRODUCTION_URL)");
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return url.origin;
}

/** A site IndexNow can't verify: plain http, localhost or a private address. */
export function isLocalSite(site) {
  const { protocol, hostname } = new URL(site);
  return protocol !== "https:" || hostname === "localhost" || hostname.endsWith(".local") || /^(127\.|10\.|192\.168\.|0\.0\.0\.0|\[?::1\]?)/.test(hostname);
}

/** Every <loc> in a sitemap (entities decoded). */
export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );
}

/** The request bodies: one per 10,000 URLs, every URL on the site's host. */
export function payloads({ site, key, urls }) {
  const host = new URL(site).host;
  const foreign = urls.filter((u) => new URL(u).host !== host);
  if (foreign.length) throw new Error(`${foreign.length} sitemap URL(s) are not on ${host}, e.g. ${foreign[0]} (was the sitemap built for another origin?)`);
  const bodies = [];
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    bodies.push({ host, key, keyLocation: `${site}/${key}.txt`, urlList: urls.slice(i, i + MAX_URLS_PER_REQUEST) });
  }
  return bodies;
}

function parseArgs(argv) {
  const args = { dryRun: false, site: undefined, sitemap: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--site") args.site = argv[++i];
    else if (a.startsWith("--site=")) args.site = a.slice(7);
    else if (a === "--sitemap") args.sitemap = argv[++i];
    else if (a.startsWith("--sitemap=")) args.sitemap = a.slice(10);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const site = resolveSite(process.env, args.site);
  if (isLocalSite(site) && !args.dryRun) {
    throw new Error(`${site} is not a public https origin; IndexNow can't fetch its key file (use --dry-run for a local check)`);
  }
  const { key, file } = findKey();

  // IndexNow fetches /<key>.txt to check the submitter controls the host: make sure it's live first.
  const served = (await fetchText(`${site}/${file}`)).trim();
  if (served !== key) throw new Error(`${site}/${file} does not serve the key (deploy public/${file} first)`);
  console.log(`✓ key file live at ${site}/${file}`);

  const source = args.sitemap ?? `${site}/sitemap.xml`;
  const xml = /^https?:\/\//i.test(source) ? await fetchText(source) : readFileSync(source, "utf8");
  const urls = [...new Set(sitemapUrls(xml))];
  if (!urls.length) throw new Error(`no <loc> URLs in ${source}`);
  const bodies = payloads({ site, key, urls });
  console.log(`✓ ${urls.length} URLs from ${source} (${bodies.length} request${bodies.length === 1 ? "" : "s"})`);

  if (args.dryRun) {
    console.log(`dry run: would POST to ${INDEXNOW_ENDPOINT}:`);
    console.log(JSON.stringify({ ...bodies[0], urlList: [...bodies[0].urlList.slice(0, 5), ...(urls.length > 5 ? [`… ${urls.length - 5} more`] : [])] }, null, 2));
    return;
  }
  for (const body of bodies) {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    // 200 OK / 202 Accepted (key check pending). 400 bad request, 403 key not valid, 422 URLs not on
    // the host or key mismatch, 429 too many requests.
    const note = { 200: "OK", 202: "accepted, key validation pending", 400: "bad request", 403: "key not valid", 422: "URLs don't match the host or key", 429: "too many requests" }[res.status] ?? res.statusText;
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered ${res.status} (${note}): ${await res.text()}`);
    console.log(`✓ IndexNow ${res.status} (${note}) for ${body.urlList.length} URLs`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ indexnow: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
