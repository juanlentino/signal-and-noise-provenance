#!/usr/bin/env node
// Verify the author's countersignatures, offline.
//
// For every countersignatures/<batch>.json: the payload holds the fixed
// statement and names this batch; the SSH signature verifies under an active
// author key in keys/key-history.json, in this ledger's namespace; the
// content hash recomputes; every listed record is a note or page record that
// passes the offline checks, with the same content hash; and the OTS proof,
// when present, commits to the batch and attests the block a confirmed batch
// names. A pending batch is reported, never failed: the Worker's sweep
// anchors it within hours.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countersignatureDivergences } from "./countersign-checks.mjs";
import { authorKeys, batchIds, BATCH_DIR, ledgerLookup, pendingProblem, readBatch, readHistory } from "./countersign-ledger.mjs";
import { bitcoinAttestation, stampedDigest, toHex } from "./verify/ots.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const keys = authorKeys(readHistory(root));
const { lookup } = await ledgerLookup(root);
const seen = new Map();
let attested = 0;
let pending = 0;

for (const id of batchIds(root)) {
  const record = readBatch(root, id);
  const problems = await countersignatureDivergences(record, { id, authorKeys: keys, lookup });
  if (problems.length) throw new Error(`countersignature ${id}: ${problems.map(([k, d]) => `${k}: ${d}`).join("; ")}`);
  const otsPath = join(root, BATCH_DIR, `${id}.ots`);
  if (existsSync(otsPath)) {
    const ots = new Uint8Array(readFileSync(otsPath));
    if (toHex(stampedDigest(ots)) !== record.content_hash) throw new Error(`countersignature ${id}: the proof commits to another digest`);
    const btc = await bitcoinAttestation(ots, record.ots?.bitcoin_block ?? null);
    if (record.ots?.status === "confirmed" && (!btc || btc.height !== record.ots.bitcoin_block)) throw new Error(`countersignature ${id}: no Bitcoin attestation at the block it names`);
  } else if (record.ots?.status === "confirmed") {
    throw new Error(`countersignature ${id}: says confirmed but has no proof`);
  }
  const waiting = pendingProblem(root, record, `${BATCH_DIR}/${id}`);
  if (waiting) throw new Error(`countersignature ${id}: ${waiting}`);
  if (record.ots?.status !== "confirmed") pending += 1;
  for (const r of record.payload.records) {
    if (seen.has(r.content_hash)) throw new Error(`countersignature ${id}: ${r.path} was already attested in ${seen.get(r.content_hash)}`);
    seen.set(r.content_hash, id);
    attested += 1;
  }
}

console.log(`${batchIds(root).length} countersignature batch(es) hold, ${attested} record(s) attested by the author key, ${pending} batch(es) awaiting their anchor`);
