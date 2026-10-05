// Reads countersign.mjs and verify-countersignatures.mjs share: the author
// keys in the history, the existing batches, and a lookup that answers
// whether a note or page record passes the ledger's offline checks.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pendingVerdict } from "./anchor-grace.mjs";
import { ledgerEvents } from "./weigh/ledger-events.mjs";

export const BATCH_DIR = "countersignatures";

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));

export function readHistory(root) {
  return readJson(root, "keys/key-history.json");
}

/**
 * The author key by id. One active author key is all the ledger accepts for
 * now: every key whose signatures count must be pinned outside GitHub, and
 * verify-key-pins.mjs pins the active one. Retiring or rotating an author key
 * needs pinned retired keys with closed validity windows, which is not built;
 * verify-key-history.mjs refuses any author key that is not active.
 */
export function authorKeys(history) {
  return new Map(history.keys.filter((k) => k.role === "author" && k.status === "active").map((k) => [k.id, k]));
}

/** Batch ids on disk, sorted. */
export function batchIds(root) {
  const dir = join(root, BATCH_DIR);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
}

export const readBatch = (root, id) => readJson(root, `${BATCH_DIR}/${id}.json`);

/**
 * The records a batch may attest: note and page records that pass every
 * offline check under a publisher key, by the path of the copy that passed.
 * Only that path answers: a file elsewhere carrying a copied content_hash is
 * not a record that passed.
 */
export async function ledgerLookup(root) {
  const { passing } = await ledgerEvents(root);
  const byPath = new Map(passing.map((r) => [r.path, r.content_hash]));
  const lookup = (path) => (byPath.has(path) ? { content_hash: byPath.get(path) } : { reason: "not a ledger record that passes the offline checks" });
  return { passing, lookup };
}

/**
 * A record that is not confirmed must be waiting in pending.json, and not for
 * longer than the ledger's grace window (anchor-grace.mjs). The status field
 * sits outside the signature, so this is what keeps a deleted proof or a
 * stalled sweep from passing as "pending" forever.
 */
export function pendingProblem(root, record, path) {
  if (record.ots?.status === "confirmed") return null;
  const queued = readJson(root, "pending.json").entries.find((e) => e.path === path);
  if (!queued) return "not confirmed and not queued for anchoring in pending.json";
  const verdict = pendingVerdict({ ots_status: record.ots?.status, published_at: queued.queued_at });
  return verdict.ok ? null : verdict.reason;
}
