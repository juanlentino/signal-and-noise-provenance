#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSite, fetchSiteJson, installEvidenceReport } from "../fetch-site.mjs";
import { recordVersions } from "../ledger-records.mjs";
installEvidenceReport("build-index");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notesRoot = join(root, "notes");
const readRecord = (uid, version) => JSON.parse(readFileSync(join(notesRoot, uid, `v${version}.json`), "utf8"));
const genesisRecord = JSON.parse(readFileSync(join(root, "genesis/2026-07-09-root.json"), "utf8"));
const genesis = new Map(genesisRecord.payload.notes.map((note) => [note.note_uid, note.leaf_hash]));
// The live REST call is load-bearing, not incidental: the set of PUBLIC notes
// is only knowable from the site, and comparing it against the ledger is the
// whole point of the reverse-coverage guard. It goes through fetchSite so an
// intercepted edge response fails as a named diagnosis rather than as a
// SyntaxError from JSON.parse (2026-08-02).
const posts = await fetchSiteJson("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=slug,link,title");
const entries = [];

for (const post of posts) {
  const { response: pageResponse, body: page } = await fetchSite(post.link, { expect: "html" });
  const uid = page.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0];
  // A text/html body with no UID passes the content-type guard but is still
  // not the Note page — a stripped, cached or interstitial variant looks
  // exactly like this. Say what actually arrived, so the next occurrence is
  // diagnosable from the CI log instead of needing a live re-run.
  if (!uid) {
    const title = page.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim() ?? "(no <title>)";
    throw new Error(
      `note UID missing on ${post.slug} — fetched ${post.link}, HTTP ${pageResponse.status}, `
      + `${page.length} bytes, cf-ray ${pageResponse.headers.get("cf-ray") || "(none)"}, `
      + `cf-cache-status ${pageResponse.headers.get("cf-cache-status") || "(none)"}, title ${JSON.stringify(title)}`,
    );
  }
  // The CURRENT record — the one the served page must reproduce. This read was
  // hardcoded to v1.json, which held only because no Note had ever been
  // edited; the first edit pinned the row to a superseded record and
  // verify:pages reported the live page as drift (start-here, 2026-08-04).
  const versions = recordVersions(notesRoot, uid);
  const record = versions.length ? readRecord(uid, versions.at(-1)) : null;
  const leafHash = genesis.get(uid);
  if (!leafHash && !record) throw new Error(`unanchored public note: ${post.slug}`);
  // The Note's STANDING anchor, which is a different question from the current
  // record's own OTS state. A record is `pending` for the hours between its
  // commit and its Bitcoin confirmation, and an edit must not un-anchor a Note
  // that has been in the chain for weeks — so the top-level anchor names the
  // newest CONFIRMED record, and `anchored_version` says which one that is.
  // Without that field a row carrying the current text's content_hash beside an
  // older record's bitcoin_block would read as a claim that the current text is
  // in that block. Falls back to the current record when nothing has confirmed
  // yet, so a never-anchored Note still fails the coverage guard as before.
  const anchorRecord = leafHash
    ? null
    : ([...versions].reverse().map((version) => readRecord(uid, version)).find((r) => "confirmed" === r.ots.status) ?? record);
  entries.push({
    note_uid: uid,
    slug: post.slug,
    title: record?.payload?.title || post.title.rendered,
    published_at: record?.payload?.published_at || new Date(page.match(/<meta\s+property="article:published_time"\s+content="([^"]+)"/i)?.[1]).toISOString().replace(".000Z", "Z"),
    anchor: leafHash ? "genesis" : "per-note",
    version: record?.payload?.version ?? 0,
    ...(record ? { content_hash: record.content_hash } : {}),
    ...(leafHash ? { leaf_hash: leafHash } : {}),
    bitcoin_block: leafHash ? genesisRecord.ots.bitcoin_block : anchorRecord.ots.bitcoin_block,
    ots_status: leafHash ? genesisRecord.ots.status : anchorRecord.ots.status,
    ...(leafHash ? {} : { anchored_version: anchorRecord.payload.version }),
    ...(record ? { standalone_ots_status: record.ots.status, standalone_bitcoin_block: record.ots.bitcoin_block ?? null } : {}),
  });
}

entries.sort((a, b) => a.published_at.localeCompare(b.published_at));

// ── Signed PAGES (2026-08-11) ────────────────────────────────────────────────
//
// Pages join by the SAME route notes take — fetch the site, read the UID out of
// the rendered page — rather than by walking pages/ on disk. That is deliberate:
// disk enumeration would list records with no way to check them against what
// the site actually serves, and the site→ledger cross-exam is the whole point
// of this file. A page record discovered from disk alone would be published
// without ever being compared to anything.
//
// THE ONE ASYMMETRY WITH NOTES: a page with no UID is NORMAL, not an error.
// Signing a page is opt-in per page (plugin v10.84.0), so most pages carry no
// provenance at all and are skipped in silence. The notes loop throws on a
// missing UID because every published note must be signed; applying that rule
// here would fail CI on every ordinary page the site has.
//
// ADDITIVE BY CONTRACT: a new top-level key, never a reshaped `entries` row —
// the rights_signals rows already have plugin-side readers and the note rows
// have more.
const pagesRoot = join(root, "pages");
const pageEntries = [];
let pagesConsidered = 0;
let pagesUnsigned = 0;

const sitePages = await fetchSiteJson("https://juanlentino.com/wp-json/wp/v2/pages?per_page=100&_fields=slug,link,title");
for (const p of sitePages) {
  pagesConsidered++;
  const { body: html } = await fetchSite(p.link, { expect: "html" });
  // Match the uid inside the PROVENANCE PANEL'S LEDGER LINK, not any
  // uuid-shaped string in the document. The notes loop can afford the loose
  // regex because a published note always renders its panel and the only uuid
  // on the page is its own; an arbitrary page can contain a uuid for any reason
  // at all. Borrowing the loose pattern here failed immediately and correctly:
  // /music/ carries a uuid with no record behind it, and the coarse matcher
  // read that as a signed page whose proof had gone missing.
  //
  // Anchoring on `/tree/main/pages/<uid>` also confirms the KIND in the same
  // match — the panel only emits that path for a subject the plugin resolved as
  // a page (plugin v10.86.0).
  const uid = html.match(/\/tree\/main\/pages\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/)?.[1];
  if (!uid) { pagesUnsigned++; continue; }          // unsigned page — expected
  const versions = recordVersions(pagesRoot, uid);
  if (!versions.length) {
    // The page advertises a provenance UID the ledger has never seen. That is a
    // real contradiction — the site claiming a proof that does not exist — and
    // is exactly the direction this cross-exam is built to catch.
    throw new Error(`page ${p.slug} renders provenance uid ${uid} but no record exists at pages/${uid}/`);
  }
  const version = versions.at(-1);
  const record = JSON.parse(readFileSync(join(pagesRoot, uid, `v${version}.json`), "utf8"));
  pageEntries.push({
    note_uid: uid,                                   // same field name as note rows: one uid namespace
    kind: "page",
    slug: p.slug,
    title: record?.payload?.title || p.title.rendered,
    version: record?.payload?.version ?? version,
    content_hash: record.content_hash,
    ots_status: record.ots.status,
    bitcoin_block: record.ots.bitcoin_block ?? null,
  });
}
pageEntries.sort((a, b) => a.slug.localeCompare(b.slug));
console.log(`pages: ${pageEntries.length} signed of ${pagesConsidered} considered (${pagesUnsigned} carry no provenance uid — expected, signing is opt-in)`);

// The rights-signals ledger has no index of its own, so anything asking "is the
// currently served robots.txt the one that is anchored?" had to probe v1, v2, …
// until a 404, or spend one of GitHub's 60 unauthenticated tree calls an hour.
// One row per surface makes that a single read of a file the ledger already
// publishes and CI already self-heals. Derived exactly like the note rows —
// newest record wins — and held to that by verify:coverage, so it cannot drift
// into the stale mirror the note rows became (2026-08-04).
const signalsRoot = join(root, "rights-signals");
const rightsSignals = readdirSync(signalsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((slug) => {
    const version = recordVersions(signalsRoot, slug).at(-1);
    if (!version) throw new Error(`rights-signal ${slug} has no records`);
    const record = JSON.parse(readFileSync(join(signalsRoot, slug, `v${version}.json`), "utf8"));
    return {
      slug,
      url: record.url,
      version,
      content_hash: record.content_hash,
      ots_status: record.ots?.status ?? "unknown",
      bitcoin_block: record.ots?.bitcoin_block ?? null,
    };
  });

// `pages` is appended, never merged into `entries`: existing readers (the
// plugin's integrity probe, the rights_signals consumers) index into `entries`
// by shape, and a row with different fields inside it would be a silent
// contract break. A reader that does not know about pages simply does not see
// them, which is the correct behaviour for an additive change.
writeFileSync(join(root, "index.json"), `${JSON.stringify({ schema: "sn-provenance-index-v1", generated_from: "public-wordpress-and-ledger", entries, pages: pageEntries, rights_signals: rightsSignals }, null, 2)}\n`);
console.log(`wrote ${entries.length} coverage entries and ${rightsSignals.length} rights-signal rows`);
