#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
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
writeFileSync(join(root, "index.json"), `${JSON.stringify({ schema: "sn-provenance-index-v1", generated_from: "public-wordpress-and-ledger", entries }, null, 2)}\n`);
console.log(`wrote ${entries.length} coverage entries`);
