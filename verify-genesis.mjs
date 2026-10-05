#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { auditPath, leafHash, rootFromLeafHashes, verifyAuditPath } from "./normalize/merkle-v1.mjs";
import { assertPublisherKey } from "./ledger-records.mjs";
import { verifyRecord } from "./verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const genesis = JSON.parse(readFileSync(join(here, "genesis/2026-07-09-root.json"), "utf8"));
const derivations = JSON.parse(readFileSync(join(here, "genesis/2026-07-09-leaves.json"), "utf8"));
const expected = genesis.payload.notes;

if (derivations.length !== expected.length) throw new Error(`expected ${expected.length} derivations, found ${derivations.length}`);
const leafHashes = derivations.map((entry, index) => {
  if (entry.note_uid !== expected[index].note_uid) throw new Error(`leaf order mismatch at ${index}`);
  const actual = leafHash(canonicalize(entry.payload));
  if (actual !== expected[index].leaf_hash) throw new Error(`leaf mismatch for ${entry.note_uid}`);
  const path = auditPath(expected.map((note) => note.leaf_hash), index);
  if (!verifyAuditPath(actual, path, genesis.payload.root)) throw new Error(`audit path mismatch for ${entry.note_uid}`);
  return actual;
});
const root = rootFromLeafHashes(leafHashes);
if (root !== genesis.payload.root || root !== genesis.content_hash) throw new Error(`root mismatch: ${root}`);
// The root's own envelope: signed by a publisher key, never the author key,
// and its proof commits to it. The Merkle checks above say nothing about who
// signed the root.
assertPublisherKey(here, genesis.pubkey_id, "the genesis root");
const envelope = await verifyRecord({
  record: genesis,
  pubB64: readFileSync(join(here, "keys", `${genesis.pubkey_id}.pub`), "utf8"),
  otsBytes: new Uint8Array(readFileSync(join(here, "genesis/2026-07-09-root.ots"))),
});
if (!envelope.hashOk || !envelope.sigOk || !envelope.otsHashOk) throw new Error(`genesis root envelope fails offline checks (hash=${envelope.hashOk}, signature=${envelope.sigOk}, otsDigest=${envelope.otsHashOk})`);
console.log(`${leafHashes.length}/${leafHashes.length} genesis leaves reproduced; root ${root} matches; all audit paths valid; root signed by ${genesis.pubkey_id}`);
