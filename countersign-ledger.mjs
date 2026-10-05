// Reads countersign.mjs and verify-countersignatures.mjs share: the author
// keys in the history, the existing batches, and a lookup that answers
// whether a note or page record passes the ledger's offline checks.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ledgerEvents } from "./weigh/ledger-events.mjs";

export const BATCH_DIR = "countersignatures";

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));

export function readHistory(root) {
  return readJson(root, "keys/key-history.json");
}

/** Author keys by id, active ones only. */
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
 * offline check under the publisher key. A record filed byte-identically in
 * two directories (the About page) answers under either path.
 */
export async function ledgerLookup(root) {
  const { passing } = await ledgerEvents(root);
  const byPath = new Map(passing.map((r) => [r.path, r.content_hash]));
  const hashes = new Set(passing.map((r) => r.content_hash));
  const lookup = (path) => {
    if (byPath.has(path)) return { content_hash: byPath.get(path) };
    if (existsSync(join(root, path))) {
      const hash = readJson(root, path).content_hash;
      if (hashes.has(hash)) return { content_hash: hash };
    }
    return { reason: "not a ledger record that passes the offline checks" };
  };
  return { passing, lookup };
}
