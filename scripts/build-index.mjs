#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSiteHtml, fetchSiteJson } from "../fetch-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  const page = await fetchSiteHtml(post.link);
  const uid = page.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0];
  if (!uid) throw new Error(`note UID missing on ${post.slug}`);
  const recordPath = join(root, `notes/${uid}/v1.json`);
  const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  const leafHash = genesis.get(uid);
  if (!leafHash && !record) throw new Error(`unanchored public note: ${post.slug}`);
  entries.push({
    note_uid: uid,
    slug: post.slug,
    title: record?.payload?.title || post.title.rendered,
    published_at: record?.payload?.published_at || new Date(page.match(/<meta\s+property="article:published_time"\s+content="([^"]+)"/i)?.[1]).toISOString().replace(".000Z", "Z"),
    anchor: leafHash ? "genesis" : "per-note",
    version: record?.payload?.version ?? 0,
    ...(record ? { content_hash: record.content_hash } : {}),
    ...(leafHash ? { leaf_hash: leafHash } : {}),
    bitcoin_block: leafHash ? genesisRecord.ots.bitcoin_block : record.ots.bitcoin_block,
    ots_status: leafHash ? genesisRecord.ots.status : record.ots.status,
    ...(record ? { standalone_ots_status: record.ots.status, standalone_bitcoin_block: record.ots.bitcoin_block ?? null } : {}),
  });
}

entries.sort((a, b) => a.published_at.localeCompare(b.published_at));
writeFileSync(join(root, "index.json"), `${JSON.stringify({ schema: "sn-provenance-index-v1", generated_from: "public-wordpress-and-ledger", entries }, null, 2)}\n`);
console.log(`wrote ${entries.length} coverage entries`);
