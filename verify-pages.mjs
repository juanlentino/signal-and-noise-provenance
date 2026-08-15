#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPageRecord } from "./verify.mjs";
import { captureEvidence, fetchSite, installEvidenceReport } from "./fetch-site.mjs";
import { classifyPageFailure, describeEdge } from "./stale-edge.mjs";
installEvidenceReport("verify:pages");

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
// Whitespace fallback source (2026-07-28): the plugin's REST hardening
// (signal-and-noise-tools PR #373) deliberately empties content.rendered for
// anonymous callers, killing the old public-REST fallback site-wide. The
// sanctioned machine-readable copy is the Note's .json twin, whose
// content_html carries the same rendered markup with source whitespace.
// A 404 here means "this Note has no twin", which is a legitimate answer and
// must stay distinguishable from "the edge intercepted us" — hence `tolerate`
// rather than swallowing every non-ok status as absence.
// Returns the markup, or a string EXPLAINING the absence — never a bare null,
// which told the caller only "missing" and could not separate an unpublished
// twin from an edge verdict.
async function twinRendered(slug) {
  const url = `https://juanlentino.com/notes/${slug}.json`;
  const { response, body: doc, raw } = await fetchSite(url, { expect: "json", tolerate: [404] });
  if (typeof doc?.content_html === "string") return { html: doc.content_html };
  // Reporting only the KEYS was still a half-diagnosis: run 30772… said
  // `200 but keys [message]` and left the message itself unread. Print the
  // document, bounded, and keep the raw bytes as a CI artifact — the edge's
  // odd answers are IP-based and unreproducible from a residential IP.
  captureEvidence("twin-unexpected", url, raw, "json");
  const why = doc === null
    ? "tolerated 404 — no twin published"
    : `HTTP ${response.status} with keys [${Object.keys(doc).join(",")}] — ${JSON.stringify(doc).slice(0, 300)}`;
  return { why: `${url} → ${why}, cf-ray ${response.headers.get("cf-ray") || "(none)"}` };
}
/**
 * Does the ORIGIN reproduce the signed record right now?
 *
 * A cache-busting query string misses both the edge cache and the origin page
 * cache, so this reads what WordPress renders at this moment. Returns null when
 * the probe cannot answer — null is NOT "matches", and classifyPageFailure
 * treats it as inconclusive, so a failed probe never excuses a real drift.
 *
 * @param {string} pageUrl Bare page URL.
 * @param {object} record  The signed record to reproduce.
 * @returns {Promise<boolean|null>}
 */
async function freshPageMatches(pageUrl, record) {
  // Fixed, non-secret buster: the value never varies by run, so a green CI log
  // stays reproducible by hand from the log line alone.
  const url = `${pageUrl}?sn-cache-probe=1`;
  try {
    const { body: freshHtml } = await fetchSite(url, { expect: "html" });
    const direct = await verifyPageRecord({ record, pageHtml: freshHtml });
    if (direct.ok) return true;
    // Same twin-whitespace allowance the bare path gets, or an origin that is
    // merely whitespace-different would read as drift.
    const twin = await twinRendered(new URL(pageUrl).pathname.split("/").filter(Boolean).at(-1));
    if (twin.why) return null;
    return (await verifyPageRecord({ record, pageHtml: freshHtml, restRendered: twin.html })).ok;
  } catch {
    return null;
  }
}

// --tolerate-stale-edge: pass a PROVEN-stale edge (origin reproduces the signed
// record, only the cached render lags) as a warning instead of a failure.
//
// Set ONLY on the Worker's own record pushes, which run seconds after the edit
// that triggered them — before any purge can propagate. Every other trigger,
// the daily schedule included, leaves it off, so a page still stale hours later
// is caught with nothing tolerated.
//
// It never softens `drift`. A page whose ORIGIN disagrees with the signed
// record still fails here, on a record push, immediately. Tampering has no
// settling window; only cache propagation does.
const tolerateStaleEdge = process.argv.includes("--tolerate-stale-edge");
const staleEdges = [];

let checked = 0;
let restFallbacks = 0;
for (const entry of index.entries) {
  if (entry.version < 1) throw new Error(`no standalone record for ${entry.slug}`);
  const record = JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.version}.json`), "utf8"));
  // Demanding text/html matters here: an interstitial or error page would
  // otherwise reach verifyPageRecord and be reported as "served-page drift",
  // blaming the Note for an edge verdict.
  const pageUrl = `https://juanlentino.com/notes/${entry.slug}/`;
  const bare = await fetchSite(pageUrl, { expect: "html" });
  const pageHtml = bare.body;
  let result = await verifyPageRecord({ record, pageHtml });
  if (!result.ok) {
    const twin = await twinRendered(entry.slug);
    if (twin.why) throw new Error(`twin content_html missing for ${entry.slug} — ${twin.why}`);
    result = await verifyPageRecord({ record, pageHtml, restRendered: twin.html });
  }
  if (!result.ok) {
    const detail = `content=${result.contentOk}, hash=${result.hashOk}, pageText=${result.pageTextOk}`;
    // Ask the ORIGIN the same question before accusing anyone of tampering.
    // A cache-busting query bypasses the edge and the origin page cache alike,
    // so this reads what WordPress renders right now.
    const fresh = await freshPageMatches(pageUrl, record);
    if ("stale-edge" === classifyPageFailure({ bareMatches: false, freshMatches: fresh })) {
      const why =
        `stale edge cache for ${entry.slug} — the ORIGIN reproduces the signed record and the bare URL does not, ` +
        `so the ledger and the content are intact and a cache is serving an older render (${detail}). ` +
        `Bare URL headers: ${describeEdge(bare.response?.headers)}. ` +
        `Purge the note URL; if a per-URL purge does not clear it, purge the zone.`;
      if (tolerateStaleEdge) {
        // A record push runs SECONDS after the edit; the purge has not
        // propagated yet, and that is not a fault. Tolerated here and here
        // only — the scheduled run has no such excuse and fails on it.
        staleEdges.push(entry.slug);
        console.warn(`::warning::${why}`);
        checked += 1;
        continue;
      }
      throw new Error(why);
    }
    throw new Error(`served-page drift for ${entry.slug} (${detail}) — the origin does not reproduce the signed record either; this is content drift, not a cache`);
  }
  if (result.source === "public-rest+served-page") restFallbacks += 1;
  checked += 1;
}
// A tolerated staleness must never read as "all clean" in the summary line —
// that is how a green run stops meaning anything. Say what was let through.
const verified = checked - staleEdges.length;
console.log(`${verified}/${checked} served pages reproduce their standalone records (${restFallbacks} twin whitespace fallback(s))`);
if (staleEdges.length) {
  console.log(
    `${staleEdges.length} page(s) tolerated as stale-edge on a record push, origin verified correct: ${staleEdges.join(", ")}. ` +
    `The next scheduled run does NOT tolerate these.`
  );
}
