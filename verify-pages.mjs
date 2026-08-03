#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPageRecord } from "./verify.mjs";
import { captureEvidence, fetchSite, fetchSiteHtml, installEvidenceReport } from "./fetch-site.mjs";
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
let checked = 0;
let restFallbacks = 0;
for (const entry of index.entries) {
  if (entry.version < 1) throw new Error(`no standalone record for ${entry.slug}`);
  const record = JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.version}.json`), "utf8"));
  // Demanding text/html matters here: an interstitial or error page would
  // otherwise reach verifyPageRecord and be reported as "served-page drift",
  // blaming the Note for an edge verdict.
  const pageHtml = await fetchSiteHtml(`https://juanlentino.com/notes/${entry.slug}/`);
  let result = await verifyPageRecord({ record, pageHtml });
  if (!result.ok) {
    const twin = await twinRendered(entry.slug);
    if (twin.why) throw new Error(`twin content_html missing for ${entry.slug} — ${twin.why}`);
    result = await verifyPageRecord({ record, pageHtml, restRendered: twin.html });
  }
  if (!result.ok) throw new Error(`served-page drift for ${entry.slug} (content=${result.contentOk}, hash=${result.hashOk}, pageText=${result.pageTextOk})`);
  if (result.source === "public-rest+served-page") restFallbacks += 1;
  checked += 1;
}
console.log(`${checked}/${checked} served pages reproduce their standalone records (${restFallbacks} twin whitespace fallback(s))`);
