#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSiteJson, installEvidenceReport } from "./fetch-site.mjs";
installEvidenceReport("verify:coverage");

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const entries = index.entries || [];
const uids = new Set(entries.map((entry) => entry.note_uid));
const slugs = new Set(entries.map((entry) => entry.slug));
if (uids.size !== entries.length || slugs.size !== entries.length) throw new Error("coverage index contains duplicate UID or slug");
for (const entry of entries) {
  if (!/^[0-9a-f-]{36}$/.test(entry.note_uid)) throw new Error(`invalid UID for ${entry.slug}`);
  if (!['genesis', 'per-note'].includes(entry.anchor)) throw new Error(`invalid anchor for ${entry.slug}`);
  if (entry.ots_status !== "confirmed" || !Number.isInteger(entry.bitcoin_block)) throw new Error(`anchor is not confirmed for ${entry.slug}`);
  if (entry.anchor === "genesis" && !/^[0-9a-f]{64}$/.test(entry.leaf_hash || "")) throw new Error(`genesis leaf missing for ${entry.slug}`);
  if (entry.version >= 1 && !/^[0-9a-f]{64}$/.test(entry.content_hash || "")) throw new Error(`standalone hash missing for ${entry.slug}`);
  // A sweep that confirms an OTS proof rewrites notes/<uid>/v1.json only. If the
  // index is not rebuilt afterwards it keeps reporting a stale mirror of that
  // record, which is invisible to the live-slug gap check below. Compare the two.
  if (entry.version >= 1) {
    const recordPath = join(root, `notes/${entry.note_uid}/v1.json`);
    if (!existsSync(recordPath)) throw new Error(`indexed record missing on disk for ${entry.slug}`);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const recordBlock = record.ots.bitcoin_block ?? null;
    if (record.content_hash !== entry.content_hash) throw new Error(`index content_hash disagrees with the record for ${entry.slug}; rerun node scripts/build-index.mjs`);
    if (record.ots.status !== entry.standalone_ots_status || recordBlock !== (entry.standalone_bitcoin_block ?? null)) {
      throw new Error(`index is stale for ${entry.slug}: record says ${record.ots.status}/${recordBlock}, index says ${entry.standalone_ots_status}/${entry.standalone_bitcoin_block ?? null}; rerun node scripts/build-index.mjs`);
    }
  }
}

// Reverse coverage (offline-safe): every record directory must have an index
// row. The forward checks above validate INDEXED rows; a record committed by
// the Worker after the last index rebuild has no row at all — invisible to
// them, and the Worker's ledger commits are all [skip ci], so the online
// live-slug check below may not run for weeks. Caught live 2026-07-28: two
// confirmed Notes (0ab100ea, 422f8047) had records but no rows while CI
// stayed green.
import { readdirSync } from "node:fs";
const unindexed = readdirSync(join(root, "notes")).filter((dir) => existsSync(join(root, `notes/${dir}/v1.json`)) && !uids.has(dir));
if (unindexed.length) throw new Error(`records missing from the index: ${unindexed.join(", ")}; rerun node scripts/build-index.mjs`);

if (!process.argv.includes("--offline")) {
  // Same unguarded shape that broke build-index.mjs on 2026-08-02 (an `ok`
  // status is not a valid payload); routed through fetchSite before it could
  // fire here too and be misread as coverage drift.
  const live = await fetchSiteJson("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=slug");
  const gaps = live.map((post) => post.slug).filter((slug) => !slugs.has(slug));
  const stale = entries.map((entry) => entry.slug).filter((slug) => !live.some((post) => post.slug === slug));
  if (gaps.length || stale.length) throw new Error(`coverage drift: gaps=${gaps.join(",") || "none"}; stale=${stale.join(",") || "none"}`);
  console.log(`${live.length}/${live.length} anchored, 0 gaps`);
} else {
  console.log(`${entries.length}/${entries.length} indexed with confirmed anchors (offline)`);
}
