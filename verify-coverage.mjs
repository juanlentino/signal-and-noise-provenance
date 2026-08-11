#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSiteJson, installEvidenceReport } from "./fetch-site.mjs";
import { recordVersions } from "./ledger-records.mjs";
import { pendingVerdict, DEFAULT_GRACE_HOURS } from "./anchor-grace.mjs";
installEvidenceReport("verify:coverage");

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const entries = index.entries || [];
const uids = new Set(entries.map((entry) => entry.note_uid));
const slugs = new Set(entries.map((entry) => entry.slug));
if (uids.size !== entries.length || slugs.size !== entries.length) throw new Error("coverage index contains duplicate UID or slug");
// An anchor still waiting on Bitcoin is a state, not a fault — see
// anchor-grace.mjs. Collected so a pass can still SAY what is outstanding.
const graceHours = Number(process.env.SN_ANCHOR_GRACE_HOURS ?? DEFAULT_GRACE_HOURS);
const pending = [];
for (const entry of entries) {
  if (!/^[0-9a-f-]{36}$/.test(entry.note_uid)) throw new Error(`invalid UID for ${entry.slug}`);
  if (!['genesis', 'per-note'].includes(entry.anchor)) throw new Error(`invalid anchor for ${entry.slug}`);
  if (entry.ots_status !== "confirmed" || !Number.isInteger(entry.bitcoin_block)) {
    const verdict = pendingVerdict(entry, { graceHours });
    if (!verdict.ok) throw new Error(`anchor is not confirmed for ${entry.slug}: ${verdict.reason}`);
    pending.push({ slug: entry.slug, hours: verdict.hours });
  }
  if (entry.anchor === "genesis" && !/^[0-9a-f]{64}$/.test(entry.leaf_hash || "")) throw new Error(`genesis leaf missing for ${entry.slug}`);
  if (entry.version >= 1 && !/^[0-9a-f]{64}$/.test(entry.content_hash || "")) throw new Error(`standalone hash missing for ${entry.slug}`);
  // A sweep that confirms an OTS proof rewrites the record in place, and an
  // edit appends a new one. If the index is not rebuilt afterwards it keeps
  // reporting a stale mirror, which is invisible to the live-slug gap check
  // below — that check compares SLUGS, and an edited Note keeps its slug.
  // Compare the row against the record it claims to describe.
  if (entry.version >= 1) {
    // The row must name the NEWEST record, not merely a real one. Pinned to
    // v1, this guard stayed green while verify:pages reported the served page
    // as drift for as long as the edit stood (start-here, 2026-08-04) — the
    // ledger accusing the site of tampering over its own stale index.
    const versions = recordVersions(join(root, "notes"), entry.note_uid);
    if (!versions.includes(entry.version)) throw new Error(`indexed record missing on disk for ${entry.slug} (index says v${entry.version}, on disk: ${versions.map((v) => `v${v}`).join(",") || "none"})`);
    const latest = versions.at(-1);
    if (entry.version !== latest) throw new Error(`index is pinned to a superseded record for ${entry.slug}: row says v${entry.version}, newest record is v${latest}; rerun node scripts/build-index.mjs`);
    const record = JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.version}.json`), "utf8"));
    const recordBlock = record.ots.bitcoin_block ?? null;
    if (record.content_hash !== entry.content_hash) throw new Error(`index content_hash disagrees with the record for ${entry.slug}; rerun node scripts/build-index.mjs`);
    if (record.ots.status !== entry.standalone_ots_status || recordBlock !== (entry.standalone_bitcoin_block ?? null)) {
      throw new Error(`index is stale for ${entry.slug}: record says ${record.ots.status}/${recordBlock}, index says ${entry.standalone_ots_status}/${entry.standalone_bitcoin_block ?? null}; rerun node scripts/build-index.mjs`);
    }
    // A per-note row's anchor may name an EARLIER version than the current
    // record, because a fresh edit is pending for hours while the Note stays
    // anchored. Whichever version it names must exist and must actually carry
    // the confirmed block the row advertises — otherwise the row asserts an
    // anchor no record backs.
    if ("per-note" === entry.anchor) {
      if (!versions.includes(entry.anchored_version)) throw new Error(`index anchors ${entry.slug} to v${entry.anchored_version}, which is not on disk; rerun node scripts/build-index.mjs`);
      const anchorRecord = entry.anchored_version === entry.version ? record : JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.anchored_version}.json`), "utf8"));
      if (anchorRecord.ots.status !== entry.ots_status || (anchorRecord.ots.bitcoin_block ?? null) !== entry.bitcoin_block) {
        throw new Error(`index anchor disagrees with v${entry.anchored_version} for ${entry.slug}: record says ${anchorRecord.ots.status}/${anchorRecord.ots.bitcoin_block ?? null}, index says ${entry.ots_status}/${entry.bitcoin_block}; rerun node scripts/build-index.mjs`);
      }
    }
  }
}

// The rights-signals rows get the same anti-stale treatment the note rows now
// get, and for the same reason: a row is only useful if it names the NEWEST
// record. A consumer that trusts a pinned row compares the live surface against
// a superseded hash and reports drift that is really index staleness — exactly
// the failure this repo shipped on 2026-08-04.
const signalsRoot = join(root, "rights-signals");
const signalRows = index.rights_signals || [];
const signalDirs = readdirSync(signalsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const unindexedSignals = signalDirs.filter((slug) => !signalRows.some((row) => row.slug === slug));
if (unindexedSignals.length) throw new Error(`rights-signals missing from the index: ${unindexedSignals.join(", ")}; rerun node scripts/build-index.mjs`);
for (const row of signalRows) {
  if (!signalDirs.includes(row.slug)) throw new Error(`index lists rights-signal ${row.slug}, which has no records on disk; rerun node scripts/build-index.mjs`);
  const latest = recordVersions(signalsRoot, row.slug).at(-1);
  if (row.version !== latest) throw new Error(`index is pinned to a superseded rights-signal record for ${row.slug}: row says v${row.version}, newest record is v${latest}; rerun node scripts/build-index.mjs`);
  const record = JSON.parse(readFileSync(join(signalsRoot, row.slug, `v${row.version}.json`), "utf8"));
  if (record.content_hash !== row.content_hash || record.url !== row.url) throw new Error(`index row disagrees with the rights-signal record for ${row.slug}; rerun node scripts/build-index.mjs`);
  if ((record.ots?.status ?? "unknown") !== row.ots_status || (record.ots?.bitcoin_block ?? null) !== row.bitcoin_block) {
    throw new Error(`index anchor is stale for rights-signal ${row.slug}: record says ${record.ots?.status}/${record.ots?.bitcoin_block ?? null}, index says ${row.ots_status}/${row.bitcoin_block}; rerun node scripts/build-index.mjs`);
  }
}

// Reverse coverage (offline-safe): every record directory must have an index
// row. The forward checks above validate INDEXED rows; a record committed by
// the Worker after the last index rebuild has no row at all — invisible to
// them, and the Worker's ledger commits are all [skip ci], so the online
// live-slug check below may not run for weeks. Caught live 2026-07-28: two
// confirmed Notes (0ab100ea, 422f8047) had records but no rows while CI
// stayed green.
const unindexed = readdirSync(join(root, "notes")).filter((dir) => recordVersions(join(root, "notes"), dir).length && !uids.has(dir));
if (unindexed.length) throw new Error(`records missing from the index: ${unindexed.join(", ")}; rerun node scripts/build-index.mjs`);

// ── Signed PAGES (2026-08-11) ────────────────────────────────────────────────
//
// The `pages` rows get the same record↔index consistency check the note rows
// get. Without this a page row could claim any hash or status and nothing would
// contradict it — which was the state the About page landed in: a real record,
// correctly signed, sitting OUTSIDE every cross-check the ledger runs. CI was
// green over it because CI only ever checked things that were indexed.
//
// The site→ledger reverse-coverage tier (below, for notes) is deliberately NOT
// applied to pages: signing a page is opt-in, so "a published page with no
// record" is normal rather than a gap, and asserting otherwise would fail on
// every ordinary page. Stated here rather than left as an absence, so the
// missing tier reads as a decision instead of an oversight.
const pageRows = Array.isArray(index.pages) ? index.pages : [];
for (const row of pageRows) {
  const versions = recordVersions(join(root, "pages"), row.note_uid);
  if (!versions.includes(row.version)) {
    throw new Error(`indexed page record missing on disk for ${row.slug} (index says v${row.version}, on disk: ${versions.map((v) => `v${v}`).join(",") || "none"})`);
  }
  const latest = versions.at(-1);
  if (row.version !== latest) {
    throw new Error(`index is pinned to a superseded page record for ${row.slug}: row says v${row.version}, newest is v${latest}; rerun node scripts/build-index.mjs`);
  }
  const record = JSON.parse(readFileSync(join(root, `pages/${row.note_uid}/v${row.version}.json`), "utf8"));
  if (record.content_hash !== row.content_hash) {
    throw new Error(`index content_hash disagrees with the page record for ${row.slug}; rerun node scripts/build-index.mjs`);
  }
  // `?? null` on the record side ONLY. A record written before worker v1.10.1
  // omits the key entirely, and absent must compare equal to the explicit null
  // the index always writes — that mismatch is exactly what reddened CI on
  // 2026-08-11.
  if (record.ots.status !== row.ots_status || (record.ots.bitcoin_block ?? null) !== (row.bitcoin_block ?? null)) {
    throw new Error(`index is stale for page ${row.slug}: record says ${record.ots.status}/${record.ots.bitcoin_block ?? null}, index says ${row.ots_status}/${row.bitcoin_block ?? null}; rerun node scripts/build-index.mjs`);
  }
}
if (pageRows.length) console.log(`${pageRows.length} signed page${pageRows.length === 1 ? "" : "s"} checked against their records`);

if (!process.argv.includes("--offline")) {
  // Same unguarded shape that broke build-index.mjs on 2026-08-02 (an `ok`
  // status is not a valid payload); routed through fetchSite before it could
  // fire here too and be misread as coverage drift.
  const live = await fetchSiteJson("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=slug");
  const gaps = live.map((post) => post.slug).filter((slug) => !slugs.has(slug));
  const stale = entries.map((entry) => entry.slug).filter((slug) => !live.some((post) => post.slug === slug));
  if (gaps.length || stale.length) throw new Error(`coverage drift: gaps=${gaps.join(",") || "none"}; stale=${stale.join(",") || "none"}`);
  console.log(`${live.length}/${live.length} anchored, 0 gaps`);
  reportPending();
} else {
  console.log(`${entries.length - pending.length}/${entries.length} indexed with confirmed anchors (offline)`);
  reportPending();
}

// A pending anchor passes, but never silently: the run names which Notes are
// waiting and for how long, so a green build never reads as "all confirmed".
function reportPending() {
  if (!pending.length) return;
  const list = pending.map((p) => `${p.slug} (${p.hours.toFixed(1)}h)`).join(", ");
  console.log(`${pending.length} anchor${pending.length === 1 ? "" : "s"} pending within the ${graceHours}h grace window: ${list}`);
}
