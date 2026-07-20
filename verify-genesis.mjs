#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { auditPath, leafHash, rootFromLeafHashes, verifyAuditPath } from "./normalize/merkle-v1.mjs";

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
console.log(`${leafHashes.length}/${leafHashes.length} genesis leaves reproduced; root ${root} matches; all audit paths valid`);
